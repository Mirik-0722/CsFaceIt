import { readFileSync } from 'node:fs'
import { access, constants, mkdir, rm } from 'node:fs/promises'
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

/** Makes the work directory ready: the demo cache stays as it is, the scratch of a run that was killed goes. */
async function prepareWorkDir(config: Config): Promise<void> {
  await mkdir(join(config.workDir, 'demos'), { recursive: true })
  await rm(join(config.workDir, 'jobs'), { recursive: true, force: true })
  await mkdir(join(config.workDir, 'jobs'), { recursive: true })
  await access(config.workDir, constants.W_OK)
}

async function main(): Promise<void> {
  const version = packageVersion()
  let config: Config
  let recorder: Recorder
  try {
    if (!zstdAvailable) {
      throw new ConfigError([
        'Node.js 22.15 or newer is needed to unpack the demos with the zstd stream of node:zlib, and this is ' +
          process.version,
      ])
    }
    config = loadConfig()
    recorder = createRecorder(config)
    await prepareWorkDir(config)
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
      `${config.heartbeatSeconds} s, keeps ${config.demoCacheItems} demos in ${config.workDir}, waits ` +
      `${config.errorBackoffSeconds} s after an error of its machine` +
      `${config.mode === 'fake' ? `, fake speed ${config.fakeSpeed}` : ''} (the worker token is set)`,
  )

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
  const rest = (seconds: number) => sleep(seconds * 1000, undefined, { signal: stop.signal }).catch(() => undefined)
  while (!stop.signal.aborted) {
    const job = await claim(api, stop.signal)
    if (job === undefined) {
      await rest(config.pollSeconds)
      continue
    }
    current = job.clipId
    const result = await runJob(deps, job, stop.signal)
    current = undefined
    if (result.environment && !stop.signal.aborted) {
      log.warn(`Taking no new clip for ${config.errorBackoffSeconds} s: the failure is of this machine, not the clip's`)
      await rest(config.errorBackoffSeconds)
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
