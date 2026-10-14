import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { Stage, WorkerJob } from '../api.js'
import { ConfigError, csdmCommand, type Config } from '../config.js'
import { log } from '../log.js'
import { childEnvironment, machineFaultInOutput } from '../machine.js'
import type { Media } from '../media.js'
import { assemble } from './assemble.js'
import {
  demoPatchVersion,
  findCs2Folder,
  gameBuild,
  killGame,
  killProcessTree,
  playableDemos,
  pluginLogPath,
  readPluginLog,
  type PluginLog,
} from './game.js'
import { RecorderError, type Recorder } from './recorder.js'

/** The reason of a clip whose demo the game will not play, as the plan words it; it is final (not retried). */
const UNPLAYABLE = 'This demo was recorded on a game version the recorder can no longer play'
/** The template of CS Demo Manager's configuration, beside `package.json` (this file is `dist/recorders/csdm.js`). */
const TEMPLATE = new URL('../../csdm-config.template.jsonc', import.meta.url)
/** How much of CS Demo Manager's output is kept for the log of a failure. */
const OUTPUT_TAIL_LENGTH = 2000
/** How often the plugin's log is read while the game runs. */
const WATCH_EVERY_MS = 2000
/** The longest time limit, as for every setting in seconds: a longer one would become a timer that fires at once. */
const MAX_LIMIT_SECONDS = 86_400
/**
 * Where the percent of the recording stage stands: the analysis is done at 5, the game has started at 10, the
 * sequences are recorded from 10 to 85, CS Demo Manager converts them from 85 to 95. The recorder's own encoding of
 * the clip is reported as the stage `ENCODING`.
 */
const PERCENT = { analyzed: 5, gameStarted: 10, recorded: 85, converted: 95 } as const
/**
 * Without the plugin's log the percent of the game is a guess from the time: the length of the recording, the time
 * the game takes to load the demo, and the jump to each sequence. Only the percent depends on it.
 */
const GUESS_LOAD_SECONDS = 60
const GUESS_SEQUENCE_SECONDS = 5

/** A run of CS Demo Manager's command line, as far as the recorder looks at it. */
interface CsdmRun {
  /** The exit code; `null` when it was killed. */
  code: number | null
  /** The end of what it wrote, both streams in the order the lines came. */
  output: string
  /** It was stopped because the game did not start playing the demo. */
  stoppedForPlayback: boolean
}

/** The part of the template the recorder fills in for every clip, and the first sequence, the pattern of all. */
interface Template {
  config: Record<string, unknown>
  sequence: Record<string, unknown>
}

/**
 * Records a clip with CS2 on this Windows machine, driven by CS Demo Manager's command line (`csdm`), the way its
 * source says it works (see README.md, "Windows"):
 *
 * 1. The demo is analyzed into CS Demo Manager's database once (`csdm analyze`), which `csdm video` needs to know the
 *    players; a marker file beside the cached demo remembers that it was.
 * 2. `csdm video --config-file` records one sequence per segment of the clip with HLAE and FFmpeg, the camera on the
 *    clip's player from the first tick of each, and closes the game at the end. The sequences come out as one MP4 each.
 * 3. The recorder joins them in the order of the clip, as H.264 `yuv420p` with AAC and `+faststart`, and applies what a
 *    montage asks for (see `assemble.ts`).
 *
 * The whole of it has a time limit, `max(CSDM_MIN_TIMEOUT_SECONDS, CSDM_TIMEOUT_FACTOR x the length of the recording)`;
 * at the limit CS Demo Manager's process tree, the game and HLAE are killed. While the game runs, the log of CS Demo
 * Manager's game plugin says whether it plays the demo; one that it does not play within `CSDM_PLAYBACK_START_SECONDS`
 * is given up early.
 */
export function createCsdmRecorder(config: Config, media: Media): Recorder {
  const command = csdmCommand(config.csdmPath)
  const template = loadTemplate()
  const playable = playableDemos(config.workDir)

  /**
   * Runs `csdm` with `args` to its end. When `signal` or `stop` aborts, the process tree is killed, and with `game` also
   * the game and HLAE, which are not in it; the run then ends with the signal's reason (`signal`) or as stopped (`stop`).
   */
  function runCsdm(
    args: string[],
    signal: AbortSignal,
    options: { game?: boolean; stop?: AbortSignal; onLine?: (line: string) => void } = {},
  ): Promise<CsdmRun> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      const child = spawn(command.executable, [command.script, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // What csdm.cmd sets: the Electron executable then runs the script as Node.js does.
        env: { ...childEnvironment(), ELECTRON_RUN_AS_NODE: '1' },
      })
      let output = ''
      for (const stream of [child.stdout, child.stderr]) {
        createInterface({ input: stream }).on('line', (line) => {
          output = `${output}${line}\n`.slice(-OUTPUT_TAIL_LENGTH)
          options.onLine?.(line)
        })
      }
      let killing: Promise<void> = Promise.resolve()
      let stopped = false
      const stop = () => {
        if (stopped) {
          return
        }
        stopped = true
        killing = (async () => {
          if (child.pid !== undefined) {
            await killProcessTree(child.pid)
          }
          if (options.game) {
            await killGame()
          }
        })()
      }
      signal.addEventListener('abort', stop, { once: true })
      options.stop?.addEventListener('abort', stop, { once: true })
      let settled = false
      const settle = (finish: () => void) => {
        signal.removeEventListener('abort', stop)
        options.stop?.removeEventListener('abort', stop)
        // Nothing goes on before the game is gone too: the next clip's CS Demo Manager would meet it.
        void killing.then(() => {
          if (!settled) {
            settled = true
            finish()
          }
        })
      }
      child.once('error', (error: NodeJS.ErrnoException) => {
        settle(() =>
          reject(
            new RecorderError('CS Demo Manager could not be started', true, {
              environment: true,
              detail: `${command.executable} ${command.script}: ${error.message}`,
            }),
          ),
        )
      })
      child.once('close', (code) => {
        settle(() => {
          if (signal.aborted) {
            reject(signal.reason)
          } else {
            resolve({ code, output, stoppedForPlayback: options.stop?.aborted ?? false })
          }
        })
      })
    })
  }

  /**
   * Makes sure CS Demo Manager's database has the match of the demo. `csdm analyze` of the released version (3.20.1)
   * ends with 0 even when the analysis failed, and a demo that is in the database already is reported as such
   * ("already in database"): a run that inserted the match is therefore followed by one that finds it, and only that
   * finding counts. At most three runs: analyze, find, and once more if the second analyzed again.
   */
  async function ensureAnalyzed(demoPath: string, signal: AbortSignal): Promise<void> {
    const marker = `${demoPath}.csdm-analyzed`
    if (await exists(marker)) {
      return
    }
    for (let run = 1; ; run++) {
      const started = Date.now()
      const result = await runCsdm(['analyze', demoPath], signal)
      if (/already in database/i.test(result.output)) {
        await writeFile(marker, `${new Date().toISOString()}\n`)
        log.info(`Demo ${basename(demoPath)}: in CS Demo Manager's database`)
        return
      }
      const inserted = /Inserting match into database|inserted into the database/i.test(result.output)
      if (run === 3 || !inserted) {
        throw analysisFailure(result)
      }
      log.info(
        `Demo ${basename(demoPath)}: analyzed by CS Demo Manager in ${((Date.now() - started) / 1000).toFixed(1)} s ` +
          `(exit code ${result.code}); checking that the match is stored`,
      )
    }
  }

  return {
    async record(job, demoPath, outDir, onProgress, signal) {
      checkJob(job)
      const recordedSeconds = job.segments.reduce(
        (sum, segment) => sum + (segment.endTick - segment.startTick) / job.tickRate,
        0,
      )
      const limitSeconds = Math.round(
        Math.min(
          MAX_LIMIT_SECONDS,
          Math.max(config.csdmMinTimeoutSeconds, config.csdmTimeoutFactor * recordedSeconds),
        ),
      )
      const deadline = AbortSignal.timeout(limitSeconds * 1000)
      const bounded = AbortSignal.any([signal, deadline])
      try {
        return await recordClip(job, demoPath, outDir, onProgress, bounded, recordedSeconds)
      } catch (error) {
        if (deadline.aborted && !signal.aborted) {
          throw new RecorderError('The recording did not finish in time', true, {
            detail: `the time limit of ${limitSeconds} s for ${recordedSeconds.toFixed(1)} s of recording was reached`,
          })
        }
        throw error
      }
    },
  }

  /** The steps of a clip, under `signal`, which also aborts at the time limit. */
  async function recordClip(
    job: WorkerJob,
    demoPath: string,
    outDir: string,
    onProgress: (stage: Stage, percent: number) => void,
    signal: AbortSignal,
    recordedSeconds: number,
  ): Promise<string> {
    const id = job.clipId
    await mkdir(outDir, { recursive: true })
    onProgress('RECORDING', 1)
    await ensureAnalyzed(demoPath, signal)
    onProgress('RECORDING', PERCENT.analyzed)

    const cs2 = await findCs2Folder(config.cs2Path)
    const build = cs2 === undefined ? undefined : await gameBuild(cs2)
    const patch = await demoPatchVersion(demoPath)
    log.info(
      `Clip ${id}: CS2 ${cs2 === undefined ? 'not found, so the game is not watched' : `in ${cs2}`}, build ` +
        `${build ?? 'unknown'}; the demo is of patch ${patch ?? 'unknown'}`,
    )

    const folder = join(outDir, 'csdm')
    await mkdir(folder, { recursive: true })
    const configFile = join(outDir, 'csdm-video.json')
    await writeFile(configFile, JSON.stringify(videoConfig(template, job, demoPath, folder), null, 2))

    const playbackStop = new AbortController()
    const startedAt = Date.now()
    let gameStartedAt: number | undefined
    let converting = false
    const report = (percent: number) => onProgress('RECORDING', percent)
    const onLine = (line: string) => {
      const text = line.trim()
      if (text === '') {
        return
      }
      log.info(`Clip ${id}: CS Demo Manager: ${text}`)
      if (/Recording in progress/i.test(text)) {
        gameStartedAt ??= Date.now()
        report(PERCENT.gameStarted)
      }
      const conversion = /Converting sequence #\d+ \((\d+)\/(\d+)\)/i.exec(text)
      if (conversion !== null) {
        converting = true
        const position = Number(conversion[1])
        const count = Math.max(1, Number(conversion[2]))
        report(PERCENT.recorded + ((PERCENT.converted - PERCENT.recorded) * (position - 1)) / count)
      }
    }

    // Reads the plugin's log while the game runs: the percent of the recording, and whether the demo plays at all.
    let watching = false
    const watch = async () => {
      if (watching || gameStartedAt === undefined || converting) {
        return
      }
      watching = true
      try {
        const sequences = job.segments.length
        const plugin: PluginLog | undefined =
          cs2 === undefined ? undefined : await readPluginLog(pluginLogPath(cs2), startedAt)
        const waited = (Date.now() - gameStartedAt) / 1000
        let share: number
        if (plugin === undefined) {
          const guess = recordedSeconds + GUESS_LOAD_SECONDS + sequences * GUESS_SEQUENCE_SECONDS
          share = Math.min(0.95, waited / guess)
        } else {
          const ongoing = plugin.sequencesStarted > plugin.sequencesEnded ? 0.5 : 0
          share = Math.min(1, (Math.min(sequences, plugin.sequencesEnded) + ongoing) / sequences)
        }
        report(PERCENT.gameStarted + (PERCENT.recorded - PERCENT.gameStarted) * share)
        // Only a plugin that has written its log (it was loaded) and does not play the demo is a sign about the demo.
        const limit = config.csdmPlaybackStartSeconds
        if (limit > 0 && plugin !== undefined && !plugin.playbackStarted && waited > limit) {
          log.warn(`Clip ${id}: the game has not started playing the demo ${Math.round(waited)} s after its start`)
          playbackStop.abort()
        }
      } catch (error) {
        log.warn(`Clip ${id}: the game could not be watched: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        watching = false
      }
    }
    const watcher = setInterval(() => void watch(), WATCH_EVERY_MS)

    let run: CsdmRun
    try {
      run = await runCsdm(['video', '--config-file', configFile], signal, {
        game: true,
        stop: playbackStop.signal,
        onLine,
      })
    } finally {
      clearInterval(watcher)
      // The actions file CS Demo Manager wrote beside the demo; it removes it itself, unless it was killed.
      await rm(`${demoPath}.json`, { force: true }).catch(() => undefined)
    }

    if (run.stoppedForPlayback) {
      throw await playbackFailure(build, patch, run)
    }
    if (run.code !== 0) {
      throw videoFailure(run)
    }
    const recordings = await findRecordings(folder, job.segments.length)
    log.info(
      `Clip ${id}: CS Demo Manager recorded ${recordings.length} sequence(s) in ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)} s`,
    )
    if (build !== undefined && patch !== undefined) {
      await playable.remember(build, patch).catch((error: unknown) => {
        log.warn(`What the game plays could not be noted: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    report(100)
    return assemble(config, media, job, recordings, outDir, onProgress, signal)
  }

  /**
   * The failure of a demo the game did not start playing. When the game, as it is now (`build`), has recorded a demo of
   * a later patch, the game works and the demo is too old for it: the plan's final reason. Otherwise nobody can tell the
   * demo from the machine (a plugin of CS Demo Manager that does not fit a new game build stops every demo the same
   * way), so it is the machine's, and tried again.
   */
  async function playbackFailure(build: string | undefined, patch: number | undefined, run: CsdmRun) {
    const newest = build === undefined ? undefined : await playable.newest(build)
    const detail =
      `the game (build ${build ?? 'unknown'}) did not start playing the demo (patch ${patch ?? 'unknown'}) within ` +
      `${config.csdmPlaybackStartSeconds} s; the newest demo it recorded is of patch ${newest ?? 'none yet'}. ` +
      `CS Demo Manager said: ${run.output.trim()}`
    if (patch !== undefined && newest !== undefined && patch < newest) {
      return new RecorderError(UNPLAYABLE, false, { detail })
    }
    return new RecorderError('The game did not start playing the demo', true, { environment: true, detail })
  }
}

/** Checks what the game is given: a SteamID it can follow, segments with a length, a picture H.264 can hold. */
function checkJob(job: WorkerJob): void {
  if (!/^\d{1,20}$/.test(job.focusSteamId)) {
    throw new RecorderError('The player of this clip has no SteamID the game can follow', false, {
      detail: `focusSteamId ${JSON.stringify(job.focusSteamId.slice(0, 40))}`,
    })
  }
  if (job.segments.some((segment) => segment.endTick <= segment.startTick)) {
    throw new RecorderError('A segment of this clip has no length', false)
  }
  if (job.width % 2 !== 0 || job.height % 2 !== 0) {
    throw new RecorderError(`H.264 needs a picture of even sides, not ${job.width}x${job.height}`, false)
  }
}

/**
 * The configuration of `csdm video` for the clip: the template, the clip's values, and what the recorder depends on,
 * whatever the template says. The game always records a 16:9 picture: a 9:16 clip is recorded at its quality on its
 * side (1280x720 for 720x1280) and cut to its shape afterwards.
 */
function videoConfig(template: Template, job: WorkerJob, demoPath: string, folder: string): Record<string, unknown> {
  const portrait = job.height > job.width
  const ffmpegSettings = (template.config.ffmpegSettings ?? {}) as Record<string, unknown>
  return {
    ...template.config,
    demoPath,
    outputFolderPath: folder,
    recordingSystem: 'HLAE',
    recordingOutput: 'video',
    encoderSoftware: 'FFmpeg',
    framerate: job.fps,
    width: portrait ? job.height : job.width,
    height: portrait ? job.width : job.height,
    closeGameAfterRecording: true,
    concatenateSequences: false,
    // The object replaces CS Demo Manager's own settings whole, so it is complete; the recorder looks for MP4 files.
    ffmpegSettings: { ...FFMPEG_SETTINGS, ...ffmpegSettings, videoContainer: 'mp4' },
    sequences: job.segments.map((segment, index) => ({
      ...template.sequence,
      // The number orders the final video; CS Demo Manager records in the order of the start ticks.
      number: index + 1,
      startTick: segment.startTick,
      endTick: segment.endTick,
      playerCameras: [{ tick: segment.startTick, playerSteamId: job.focusSteamId, playerName: '' }],
      cameras: [],
    })),
  }
}

/** CS Demo Manager's FFmpeg settings with the codecs a browser plays, for a template that leaves fields out. */
const FFMPEG_SETTINGS = {
  audioBitrate: 256,
  constantRateFactor: 18,
  customLocationEnabled: false,
  customExecutableLocation: '',
  videoContainer: 'mp4',
  videoCodec: 'libx264',
  audioCodec: 'aac',
  inputParameters: '',
  outputParameters: '',
}

/**
 * Reads the template once, at start, so that a broken one stops the recorder with its reason instead of failing every
 * clip. Whole lines that start with `//` are comments.
 */
function loadTemplate(): Template {
  const path = fileURLToPath(TEMPLATE)
  let parsed: unknown
  try {
    const text = readFileSync(TEMPLATE, 'utf8')
    const json = text
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    if (json.includes('#')) {
      throw new Error("it holds a '#', which CS Demo Manager would cut out as a comment")
    }
    parsed = JSON.parse(json)
  } catch (error) {
    throw new ConfigError([
      `The template of CS Demo Manager's configuration ${path} cannot be used: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    ])
  }
  const { sequences, ...config } = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >
  const sequence: unknown = Array.isArray(sequences) ? sequences[0] : undefined
  if (typeof sequence !== 'object' || sequence === null || Array.isArray(sequence)) {
    throw new ConfigError([`The template ${path} needs a list "sequences" whose first item is an object`])
  }
  return { config, sequence: sequence as Record<string, unknown> }
}

/**
 * The MP4 of each sequence, in the order of the numbers 1 to `count`: `sequence-<n>-tick-<a>-to-<b>.mp4`, directly in
 * the output folder (3.20.1) or in a folder of the video's id inside it (the version after, which queues videos).
 */
async function findRecordings(folder: string, count: number): Promise<string[]> {
  const byNumber = new Map<number, string>()
  const names = await readdir(folder, { recursive: true }).catch(() => [] as string[])
  for (const name of names) {
    const match = /^sequence-(\d+)-tick-\d+-to-\d+\.mp4$/i.exec(basename(name))
    if (match !== null && !byNumber.has(Number(match[1]))) {
      byNumber.set(Number(match[1]), join(folder, name))
    }
  }
  const recordings: string[] = []
  for (let number = 1; number <= count; number++) {
    const recording = byNumber.get(number)
    if (recording === undefined) {
      throw new RecorderError('CS Demo Manager made no video of the clip', true, {
        detail: `no video of sequence ${number} of ${count} in ${folder}; there are: ${names.join(', ') || 'no files'}`,
      })
    }
    recordings.push(recording)
  }
  return recordings
}

/**
 * Why `csdm video` failed, from what it printed: the message of its error (`error.message`, printed before it exits
 * with 1) tells the machine's faults (no Steam, no game, HLAE, the database) from the others.
 */
function videoFailure(run: CsdmRun): RecorderError {
  const output = run.output.trim()
  const detail = `csdm video exited with code ${run.code}: ${output}`
  const machine = machineFaultInOutput(output, detail)
  if (machine !== undefined) {
    return machine
  }
  const environment = (message: string) => new RecorderError(message, true, { environment: true, detail })
  if (/Steam is not running/i.test(output)) {
    return environment('Steam is not running on the recorder')
  }
  if (/CS executable not found/i.test(output)) {
    return environment('The recorder cannot find CS2')
  }
  // A first run prints "Installing HLAE..." and "Installing FFmpeg...": only the messages of errors count.
  if (/HLAE error|HLAE is not installed/i.test(output)) {
    return environment('HLAE could not start the game')
  }
  if (/Game error/i.test(output)) {
    return environment('The game closed with an error')
  }
  if (DATABASE_TROUBLE.test(output)) {
    return environment('CS Demo Manager cannot reach its database')
  }
  if (/connect to the CS Demo Manager daemon/i.test(output)) {
    return environment('CS Demo Manager could not be started')
  }
  if (/FFmpeg error|FFmpeg is not installed|Raw files not found/i.test(output)) {
    return new RecorderError('CS Demo Manager could not encode the recording', true, { detail })
  }
  return new RecorderError('CS Demo Manager could not record the clip', true, { detail })
}

/** Why `csdm analyze` did not get the match into the database. */
function analysisFailure(run: CsdmRun): RecorderError {
  const output = run.output.trim()
  const detail = `csdm analyze exited with code ${run.code}: ${output}`
  if (DATABASE_TROUBLE.test(output)) {
    return new RecorderError('CS Demo Manager cannot reach its database', true, { environment: true, detail })
  }
  if (/Corrupted demo|ErrUnexpectedEndOfDemo/i.test(output)) {
    return new RecorderError('The demo file is damaged', false, { detail })
  }
  return (
    machineFaultInOutput(output, detail) ??
    new RecorderError('CS Demo Manager could not analyze the demo', true, { detail })
  )
}

/** What CS Demo Manager prints when its PostgreSQL is not there or does not let it in. */
const DATABASE_TROUBLE =
  /connect to the database|ECONNREFUSED|password authentication failed|database .* does not exist|schema version/i

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined
}
