import { readFileSync } from 'node:fs'
import { access, constants, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { ApiError, createApi, MalformedJobError, type Api, type WorkerJob } from './api.js'
import { ConfigError, loadConfig, type Config } from './config.js'
import { createDemoCache, zstdAvailable } from './demoCache.js'
import { runJob, type JobDeps } from './job.js'
import { log } from './log.js'
import { createMedia } from './media.js'
import { createFakeRecorder } from './recorders/fake.js'
import type { Recorder } from './recorders/recorder.js'

/** The recorder is asked to stop with a signal, and Docker waits 10 seconds before it kills: leave within this. */
const FORCE_EXIT_MS = 8000

function packageVersion(): string {
  try {
    const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const version = (manifest as { version?: unknown }).version
    return typeof version === 'string' ? version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** The recorder of the mode. `csdm`, which drives the game, has none yet: only the fake recorder exists. */
function createRecorder(config: Config): Recorder {
  switch (config.mode) {
    case 'fake':
      return createFakeRecorder(config)
    case 'csdm':
      throw new ConfigError([
        'RECORDER_MODE=csdm (recording with the game) is not part of this version of the recorder yet. ' +
          'RECORDER_MODE=fake records a test pattern instead.',
      ])
  }
}

/**
 * Makes the work directory ready. The demo cache stays as it is, but what a run that was killed left half done goes: the
 * scratch directories of its clips, and the downloads that were not finished (the files directly in `demos/` that
 * end in `.part`). The directory belongs to one recorder, so none of them is in use. Returns how many downloads went.
 */
async function prepareWorkDir(config: Config): Promise<number> {
  const demos = join(config.workDir, 'demos')
  await mkdir(demos, { recursive: true })
  let unfinished = 0
  for (const entry of await readdir(demos, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.part')) {
      await rm(join(demos, entry.name), { force: true })
      unfinished++
    }
  }
  await rm(join(config.workDir, 'jobs'), { recursive: true, force: true })
  await mkdir(join(config.workDir, 'jobs'), { recursive: true })
  await access(config.workDir, constants.W_OK)
  return unfinished
}

/**
 * How long the loop takes no new clip after a job that failed. A clip that goes back to the queue keeps its place at
 * the head of it, so a recorder that asked again at once would take it again at once, and with a fault that does not
 * go away it would use up the attempts of every clip in the queue before anyone could react. The first failure after
 * a finished clip (or after the start) therefore waits `POLL_SECONDS`, and each further one in a row twice as long as
 * the one before, up to `ERROR_BACKOFF_SECONDS`: 5, 10, 20, 40, 80, 160, 300, 300, ... seconds with the defaults. A
 * failure of the machine itself waits `ERROR_BACKOFF_SECONDS` at once, as the next clip would meet the same fault.
 * Never less than `POLL_SECONDS`, so that after a failure the loop does not ask sooner than an idle one does.
 *
 * @param failures how many jobs in a row have failed, this one included
 */
function pauseAfterFailure(failures: number, ofMachine: boolean, config: Config): number {
  const wanted = ofMachine
    ? config.errorBackoffSeconds
    : Math.min(config.pollSeconds * 2 ** (failures - 1), config.errorBackoffSeconds)
  return Math.max(config.pollSeconds, wanted)
}

async function main(): Promise<void> {
  const version = packageVersion()
  let config: Config
  let recorder: Recorder
  let unfinishedDownloads: number
  try {
    if (!zstdAvailable) {
      throw new ConfigError([
        'Node.js 22.15 or newer is needed to unpack the demos with the zstd stream of node:zlib, and this is ' +
          process.version,
      ])
    }
    config = loadConfig()
    recorder = createRecorder(config)
    unfinishedDownloads = await prepareWorkDir(config)
  } catch (error) {
    // A start that cannot go on says why in plain words, not with a stack, and does not look like a crash.
    console.error(error instanceof ConfigError ? error.message : `The recorder cannot start: ${String(error)}`)
    process.exit(2)
  }

  const api = createApi(config, version)
  const deps: JobDeps = {
    config,
    api,
    demos: createDemoCache(config, api),
    media: createMedia(config.ffmpegPath, config.ffprobePath),
    recorder,
  }
  log.info(
    `Recorder ${version} starts as '${config.workerName}' in mode ${config.mode}: backend ${config.backendUrl}, ` +
      `qualities ${config.qualities.join(',')}, asks for work every ${config.pollSeconds} s, heartbeat every ` +
      `${config.heartbeatSeconds} s, keeps ${config.demoCacheItems} demos in ${config.workDir}, after a failed clip ` +
      `waits ${config.pollSeconds} s, twice as long for each failure in a row, up to ` +
      `${Math.max(config.pollSeconds, config.errorBackoffSeconds)} s (an error of its machine: that long at once)` +
      `${config.mode === 'fake' ? `, fake speed ${config.fakeSpeed}` : ''} (the worker token is set)`,
  )
  if (unfinishedDownloads > 0) {
    log.info(`Removed ${unfinishedDownloads} unfinished download(s) that a run which was stopped left in the demo cache`)
  }

  const stop = new AbortController()
  /** The clip being worked on, for the heartbeat and for what a stop has to give back. */
  let current: number | undefined
  const stopOn = (name: string) => {
    if (stop.signal.aborted) {
      log.warn(`${name} again: leaving at once`)
      process.exit(1)
    }
    log.info(`${name} received: ${current === undefined ? 'stopping' : `giving clip ${current} back, then stopping`}`)
    stop.abort(new Error(`The recorder received ${name}`))
    setTimeout(() => {
      log.error('The recorder did not stop in time: leaving')
      process.exit(1)
    }, FORCE_EXIT_MS).unref()
  }
  process.on('SIGINT', () => stopOn('SIGINT'))
  process.on('SIGTERM', () => stopOn('SIGTERM'))
  process.on('unhandledRejection', (reason) => {
    log.error(`Unhandled error: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
    process.exit(1)
  })

  const heartbeat = startHeartbeat(api, config, stop.signal, () => current)
  // Every wait of the loop ends at once on a stop.
  const rest = (seconds: number) => sleep(seconds * 1000, undefined, { signal: stop.signal }).catch(() => undefined)
  /** How many jobs in a row have failed: a finished clip puts it back to 0, a lost claim and a stop leave it. */
  let failures = 0
  while (!stop.signal.aborted) {
    const job = await claim(api, stop.signal)
    if (job === undefined) {
      await rest(config.pollSeconds)
      continue
    }
    current = job.clipId
    const result = await runJob(deps, job, stop.signal)
    current = undefined
    if (result.outcome === 'done') {
      failures = 0
    } else if (result.outcome === 'failed' && !stop.signal.aborted) {
      failures++
      const pause = pauseAfterFailure(failures, result.environment, config)
      const why = result.environment
        ? "the failure is of this machine, not the clip's"
        : `${failures} ${failures === 1 ? 'failure' : 'failures'} in a row`
      log.warn(`Taking no new clip for ${pause} s: ${why}`)
      await rest(pause)
    }
  }
  clearInterval(heartbeat)
  log.info('The recorder has stopped')
  process.exit(0)
}

/**
 * Asks for a clip. Nothing to do (204), and anything that goes wrong, come back as `undefined`, and the loop asks
 * again after `POLL_SECONDS`: a backend that is down or a token that is wrong is no reason to stop, so the recorder
 * says what is the matter on every try and goes on, and works again as soon as it is put right.
 */
async function claim(api: Api, stop: AbortSignal): Promise<WorkerJob | undefined> {
  try {
    return await api.claim({ signal: stop })
  } catch (error) {
    if (stop.aborted) {
      return undefined
    }
    if (error instanceof MalformedJobError) {
      log.error(error.message)
      if (error.clipId !== undefined) {
        // The backend has given the clip to this recorder, which cannot read what to do: say so, and not again.
        await api.fail(error.clipId, error.message, false).catch(() => undefined)
      }
    } else if (error instanceof ApiError && error.tokenRefused) {
      log.error(error.message)
    } else {
      log.warn(`No clip taken: ${error instanceof Error ? error.message : String(error)}`)
    }
    return undefined
  }
}

/** Tells the backend that the recorder is there, now and then, with or without a clip. Returns the timer. */
function startHeartbeat(
  api: Api,
  config: Config,
  stop: AbortSignal,
  clip: () => number | undefined,
): NodeJS.Timeout {
  let sending = false
  const beat = async () => {
    if (sending) {
      return
    }
    sending = true
    try {
      const clipId = clip()
      await api.heartbeat(clipId === undefined ? 'IDLE' : 'WORKING', clipId ?? null, { signal: stop })
    } catch (error) {
      if (!stop.aborted) {
        log.warn(`Heartbeat not delivered: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      sending = false
    }
  }
  beat().catch(() => undefined)
  return setInterval(() => {
    beat().catch(() => undefined)
  }, config.heartbeatSeconds * 1000)
}

await main()
