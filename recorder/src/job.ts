import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ApiError,
  ClaimLostError,
  videoSeconds,
  type Api,
  type RequestOptions,
  type Stage,
  type WorkerJob,
} from './api.js'
import type { Config } from './config.js'
import type { DemoCache } from './demoCache.js'
import { log } from './log.js'
import type { Media } from './media.js'
import { RecorderError, type Recorder } from './recorders/recorder.js'

export interface JobDeps {
  config: Config
  api: Api
  demos: DemoCache
  media: Media
  recorder: Recorder
}

export interface JobResult {
  /** `done`: finished. `failed`: given back or given up. `lost`: no longer ours. `stopped`: the recorder is leaving. */
  outcome: 'done' | 'failed' | 'lost' | 'stopped'
  /** The failure was the machine's own (`RecorderError.environment`): the loop takes no new clip for a while. */
  environment: boolean
}

/**
 * How often the backend is told where the recorder is while it holds a clip, whatever the stage and whether or not
 * the recording has anything new to say. The backend takes a clip back when it hears nothing for `clip.stale-after`
 * (3 minutes), and an upload from a home line can last longer than that, so this is a timer and not a by-product of
 * the recording. The rule is at most 10 seconds apart; this is the pace of the pages that show the percent.
 */
const KEEP_ALIVE_MS = 3000
/** What a recorder that is being stopped may spend on giving its clip back: Docker waits 10 seconds in all. */
const GIVE_BACK_OPTIONS: RequestOptions = { retries: 0, timeoutMs: 4000 }

const STAGE_ORDER: Record<Stage, number> = { RECORDING: 0, ENCODING: 1, UPLOADING: 2 }

/**
 * Takes one clip from its demo to its video and the backend: the demo, the recording, a thumbnail, the probe, the two
 * uploads and the word that it is finished. Whatever goes wrong is answered the way the backend needs: a clip whose
 * claim is lost is dropped without a word (it is no longer ours to fail), a recorder that is being stopped gives its
 * clip back at once for another try, and any other failure is told with its reason and whether trying again can help.
 * The scratch directory of the clip is emptied in every case.
 *
 * @param stop aborts when the recorder is asked to stop
 */
export async function runJob(deps: JobDeps, job: WorkerJob, stop: AbortSignal): Promise<JobResult> {
  const { config, api, demos, media, recorder } = deps
  const id = job.clipId
  // Aborted by the job itself: a claim that is lost, or the backend that cannot be reached to keep the clip alive.
  const own = new AbortController()
  const signal = AbortSignal.any([stop, own.signal])
  const reporter = createReporter(api, id, signal, (error) => {
    // Once the job is aborted for a reason, what else goes wrong is only that reason's echo.
    if (!signal.aborted) {
      own.abort(error)
    }
  })
  const dir = join(config.workDir, 'jobs', String(id))
  const started = Date.now()
  // What the job is at, for the log when it is stopped from outside: a lost claim says what it interrupted.
  let doing = 'starting'
  log.info(
    `Clip ${id}: claimed, a ${job.kind} of match ${job.matchId} on ${job.mapName ?? 'an unknown map'}: ` +
      `${job.segments.length} segment(s), ${videoSeconds(job).toFixed(1)} s at ${job.width}x${job.height} and ` +
      `${job.fps} fps, following player ${job.focusSteamId}`,
  )
  try {
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    reporter.start()

    // The claim made the clip RECORDING at 0%: getting the demo is part of that stage.
    log.info(`Clip ${id}: RECORDING`)
    doing = 'getting the demo'
    const demoPath = await demos.ensure(job, signal)
    doing = 'recording'
    const video = await recorder.record(job, demoPath, dir, reporter.update, signal)

    log.info(`Clip ${id}: ENCODING`)
    doing = 'encoding'
    await reporter.enter('ENCODING', 100)
    const thumbnail = join(dir, 'thumbnail.jpg')
    await media.thumbnail(video, thumbnail, signal)
    const probe = await media.probe(video, signal)

    log.info(`Clip ${id}: UPLOADING ${probe.sizeBytes} bytes of video`)
    doing = 'uploading the video'
    await reporter.enter('UPLOADING', 100)
    await api.uploadVideo(id, video, { signal })
    doing = 'uploading the thumbnail'
    await api.uploadThumbnail(id, thumbnail, { signal })

    // No progress report may arrive after the clip is finished: the backend would answer it with a 409.
    doing = 'finishing the clip'
    await reporter.stop()
    await api.complete(id, { durationMs: probe.durationMs, width: probe.width, height: probe.height }, { signal })
    log.info(
      `Clip ${id}: DONE, ${probe.durationMs} ms, ${probe.width}x${probe.height}, ${probe.sizeBytes} bytes, ` +
        `${((Date.now() - started) / 1000).toFixed(1)} s from the claim`,
    )
    return { outcome: 'done', environment: false }
  } catch (error) {
    // What is still under way (a report on its way, a child process) stops now, so that nothing delays what follows.
    if (!signal.aborted) {
      own.abort(error)
    }
    await reporter.stop()
    // Why the job ended: what aborted it, if something did (the errors that abort causes are only its echo), or the
    // error itself.
    const reason = own.signal.aborted ? own.signal.reason : error
    if (reason instanceof ClaimLostError) {
      // Whatever was in flight, an upload included, has been aborted by the abort above or by the one that came first.
      log.warn(`Clip ${id}: ${reason.message}; stopped at once while ${doing}, and nothing is sent about it`)
      return { outcome: 'lost', environment: false }
    }
    if (stop.aborted && !own.signal.aborted) {
      await giveUp(api, id, 'The recorder was stopped', true, GIVE_BACK_OPTIONS)
      return { outcome: 'stopped', environment: false }
    }
    const failure = describe(reason)
    // The message goes to the backend, and from there to the page of the clip; the detail stays in this log.
    const outlook = failure.retryable ? 'another attempt may do better' : 'not to be tried again'
    log.error(
      `Clip ${id}: failed while ${doing}, ${outlook}: ${failure.message}` +
        (failure.detail === undefined ? '' : ` [${failure.detail}]`),
    )
    await giveUp(api, id, failure.message, failure.retryable)
    return { outcome: 'failed', environment: failure.environment }
  } finally {
    await reporter.stop()
    await rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
      log.warn(`Clip ${id}: the work directory ${dir} could not be emptied: ${messageOf(error)}`)
    })
  }
}

/** Tells the backend that the attempt is over. Best effort: it may well be the backend that cannot be reached. */
async function giveUp(
  api: Api,
  clipId: number,
  message: string,
  retryable: boolean,
  options?: RequestOptions,
): Promise<void> {
  try {
    await api.fail(clipId, message, retryable, options)
    log.info(`Clip ${clipId}: the backend was told the attempt is over (${retryable ? 'may be tried again' : 'final'})`)
  } catch (error) {
    if (error instanceof ClaimLostError) {
      log.warn(`Clip ${clipId}: ${error.message}; there is nothing to give back`)
    } else {
      log.warn(`Clip ${clipId}: the failure could not be reported to the backend: ${messageOf(error)}`)
    }
  }
}

interface Failure {
  /** What the backend is told, and shows to every visitor of the clip: a short reason, nothing local. */
  message: string
  /** What goes to the log of the recorder alone. */
  detail: string | undefined
  retryable: boolean
  environment: boolean
}

/**
 * What the backend is told about a failure, and whether trying again can help. The reason is written here from the
 * kind of failure and never taken from a system error, an answer or the output of a tool, which carry paths, hosts
 * and addresses of this machine and its network; that text is kept as the detail for the log.
 */
function describe(error: unknown): Failure {
  if (error instanceof RecorderError) {
    return {
      message: error.message,
      detail: error.detail,
      retryable: error.retryable,
      environment: error.environment,
    }
  }
  if (error instanceof ApiError) {
    return { ...reasonOf(error), detail: error.message, environment: false }
  }
  if (error instanceof Error && error.stack !== undefined) {
    log.error(`Unexpected error: ${error.stack}`)
  }
  return {
    message: 'Unexpected error of the recorder',
    detail: messageOf(error),
    retryable: true,
    environment: false,
  }
}

/** The reason to give for an answer of the backend that the recorder cannot go on with. */
function reasonOf(error: ApiError): { message: string; retryable: boolean } {
  if (error.status === 410) {
    return { message: 'The demo file is no longer stored', retryable: false }
  }
  if (error.status === 413) {
    return { message: 'The recording is larger than the backend accepts', retryable: false }
  }
  if (error.status === 0) {
    return { message: 'The recorder could not reach the backend', retryable: true }
  }
  if (error.status >= 500) {
    return { message: `The backend answered with an error (HTTP ${error.status})`, retryable: true }
  }
  if (error.code === 'CLIP_VIDEO_MISSING') {
    return { message: 'The backend has no video of this attempt', retryable: true }
  }
  if (error.tokenRefused) {
    return { message: 'The backend does not accept the recorder', retryable: true }
  }
  return { message: `The backend refused a request of the recorder (HTTP ${error.status})`, retryable: true }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface Reporter {
  /** Starts the timer. */
  start(): void
  /** Notes where the recording is, for the next report; a stage never goes back. Sends nothing by itself. */
  update(stage: Stage, percent: number): void
  /** Moves to a stage and reports it at once, so that the backend shows it before the work of the stage begins. */
  enter(stage: Stage, percent: number): Promise<void>
  /** Stops the timer and waits for a report that is on its way, so that none is sent after this returns. */
  stop(): Promise<void>
}

/**
 * Sends the stage and the last known percent to the backend every `KEEP_ALIVE_MS`, one request at a time and in order
 * (a late report must not overwrite a newer one). A report that cannot be delivered after the tries of `api.ts`, or
 * is answered with a 409, ends the job through `fatal`: the clip is lost, or the backend is out of reach.
 */
function createReporter(api: Api, clipId: number, signal: AbortSignal, fatal: (error: unknown) => void): Reporter {
  let stage: Stage = 'RECORDING'
  let percent = 0
  let timer: NodeJS.Timeout | undefined
  let chain: Promise<void> = Promise.resolve()
  let pending = 0

  /** Reports the stage and percent as they are when its turn comes. */
  function send(): Promise<void> {
    pending++
    const turn = chain.then(async () => {
      try {
        await api.progress(clipId, stage, percent, { signal })
      } finally {
        pending--
      }
    })
    chain = turn.catch(() => undefined)
    return turn
  }

  return {
    start() {
      timer = setInterval(() => {
        // A report that is still on its way (the backend is slow) is not followed by another one.
        if (pending === 0) {
          send().catch(fatal)
        }
      }, KEEP_ALIVE_MS)
    },

    update(next, value) {
      if (STAGE_ORDER[next] >= STAGE_ORDER[stage]) {
        stage = next
        percent = Math.max(0, Math.min(100, Math.round(value)))
      }
    },

    async enter(next, value) {
      stage = next
      percent = value
      try {
        await send()
      } catch (error) {
        fatal(error)
        throw error
      }
    },

    async stop() {
      clearInterval(timer)
      await chain
    },
  }
}
