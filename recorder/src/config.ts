import { existsSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** The sizes of picture the backend knows, as it writes them (`ClipQuality`); a recorder says which it can record. */
export const QUALITIES = ['720p', '1080p'] as const
export type Quality = (typeof QUALITIES)[number]

/** How the clips are recorded: `fake` is a test pattern made by ffmpeg, `csdm` plays the game with CS Demo Manager. */
export const MODES = ['fake', 'csdm'] as const
export type Mode = (typeof MODES)[number]

/** The longest name the backend keeps for a recorder (`WorkerLimits.NAME`); a longer one is refused as invalid. */
const MAX_NAME_LENGTH = 64

/**
 * What a name is made of (`WorkerLimits.PLAIN`): letters, digits, `.`, `_` and `-`. The backend answers every request
 * of a recorder whose name has another character with a 400, so such a recorder would never get work: it is refused
 * here, at start, instead.
 */
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/

/** The variable that holds the secret of the worker API: read here, and left out of what child processes inherit. */
export const WORKER_TOKEN_VARIABLE = 'CLIP_WORKER_TOKEN'

/**
 * The most a setting in seconds may be: one day. Such a setting becomes a timer of milliseconds, and Node runs a timer
 * of more than 2^31 - 1 ms (about 24.8 days) after 1 ms, so a number without a limit would turn a long wait into none.
 */
const MAX_SECONDS = 86_400

export interface Config {
  /** Where the backend is, without a trailing slash: the recorder only ever calls `/api/worker/v1/**` there. */
  backendUrl: string
  /** The secret of the worker API. Never logged, never put in a message. */
  workerToken: string
  workerName: string
  mode: Mode
  /** An absolute path: the demo cache is `<workDir>/demos`, the scratch directory of each clip `<workDir>/jobs`. */
  workDir: string
  /** How long the loop waits before it asks for work again; also the shortest pause after a failed job. */
  pollSeconds: number
  heartbeatSeconds: number
  demoCacheItems: number
  qualities: Quality[]
  ffmpegPath: string
  ffprobePath: string
  /**
   * The longest pause after failed jobs, which grow from `pollSeconds` by doubling, and the pause after a failure of the
   * recorder's own machine (see `RecorderError.environment`), which is this long at once.
   */
  errorBackoffSeconds: number
  /** Seconds of video the fake recorder makes per second of wall time; 0 is as fast as ffmpeg goes. */
  fakeSpeed: number
  /**
   * csdm mode: where CS Demo Manager's command line is, its `csdm.cmd` or the folder that holds it (see `csdmCommand`).
   * Empty when no default could be made (not on Windows) and none was given, which only matters in csdm mode.
   */
  csdmPath: string
  /** csdm mode: the shortest time limit of a clip, in seconds (see `CSDM_TIMEOUT_FACTOR`). */
  csdmMinTimeoutSeconds: number
  /** csdm mode: the time limit of a clip is this many times the length of its recording, or the shortest limit. */
  csdmTimeoutFactor: number
  /** csdm mode: how long the game may take from its start until it plays the demo, in seconds; 0 does not watch it. */
  csdmPlaybackStartSeconds: number
  /** csdm mode: the folder of CS2 (`...\Counter-Strike Global Offensive`) when it is given; else Steam is asked. */
  cs2Path: string | undefined
}

/** How CS Demo Manager's command line is started: `executable` runs `script` as Node.js does. */
export interface CsdmCommand {
  executable: string
  script: string
  /** The archive that holds `script`: a file, and the one of the two that can be checked from outside Electron. */
  archive: string
}

/**
 * CS Demo Manager's `csdm.cmd` (`build-assets/bin/csdm.cmd` in its repository) only sets `ELECTRON_RUN_AS_NODE=1` and
 * runs `cs-demo-manager.exe resources\app.asar\cli.js` from its own folder. The recorder does the same itself: Node.js
 * starts a `.cmd` only through a shell, whose quoting a path with spaces does not survive well, and a process tree
 * without the shell is one process shorter to kill.
 */
export function csdmCommand(csdmPath: string): CsdmCommand {
  const folder = /\.cmd$/i.test(csdmPath) ? dirname(csdmPath) : csdmPath
  const archive = join(folder, 'resources', 'app.asar')
  return { executable: join(folder, 'cs-demo-manager.exe'), script: join(archive, 'cli.js'), archive }
}

/**
 * Where CS Demo Manager's installer puts it: one folder per user, `%LOCALAPPDATA%\Programs\cs-demo-manager` (the
 * one-click NSIS installer of electron-builder, named after the package), with `csdm.cmd` in it.
 */
function defaultCsdmPath(env: NodeJS.ProcessEnv): string | undefined {
  const localAppData = env.LOCALAPPDATA?.trim()
  return localAppData ? join(localAppData, 'Programs', 'cs-demo-manager', 'csdm.cmd') : undefined
}

/**
 * Where CS Demo Manager keeps the FFmpeg it downloads for its videos (`%USERPROFILE%\.csdm\ffmpeg\bin`, a BtbN build
 * with `ffprobe.exe` beside `ffmpeg.exe`). In csdm mode the recorder uses it too unless `FFMPEG_PATH` says otherwise,
 * so that the machine needs no second copy; it is there once CS Demo Manager has made its first video.
 */
function csdmToolsFolder(): string {
  return join(homedir(), '.csdm', 'ffmpeg', 'bin')
}

/** The settings are wrong or missing; the message names every problem at once, so that one start shows them all. */
export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`The recorder cannot start:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`)
    this.name = 'ConfigError'
  }
}

/** Reads and checks the settings. A variable that is set but empty counts as not set, as Compose passes it. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = []

  const text = (name: string): string | undefined => {
    const raw = env[name]?.trim()
    return raw === undefined || raw === '' ? undefined : raw
  }
  const required = (name: string, hint: string): string => {
    const value = text(name)
    if (value === undefined) {
      problems.push(`${name} is required: ${hint}`)
      return ''
    }
    return value
  }
  const wholeNumber = (name: string, fallback: number, min: number, max?: number): number => {
    const raw = text(name)
    if (raw === undefined) {
      return fallback
    }
    const value = /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN
    if (value >= min && (max === undefined || value <= max)) {
      return value
    }
    // Only a setting with an upper bound is one in seconds (see `seconds`), and its message names the unit.
    const range = max === undefined ? `of at least ${min}` : `of seconds from ${min} to ${max}`
    problems.push(`${name} must be a whole number ${range}, not '${raw}'`)
    return fallback
  }
  const seconds = (name: string, fallback: number, min: number): number =>
    wholeNumber(name, fallback, min, MAX_SECONDS)

  const backendUrl = backendUrlOf(
    required('BACKEND_URL', 'the address of the backend, such as http://backend:8080'),
    problems,
  )
  // The value is not repeated in a problem: it is a secret.
  const workerToken = required(WORKER_TOKEN_VARIABLE, 'the secret the backend was started with')

  const workerNameText = text('WORKER_NAME')
  const workerName = workerNameText ?? hostname()
  if (!NAME_PATTERN.test(workerName) || workerName.length > MAX_NAME_LENGTH) {
    const rule = `1 to ${MAX_NAME_LENGTH} characters, only letters, digits, '.', '_' and '-'`
    // The host name is the default, and on some machines it holds other characters (a space, an accent).
    problems.push(
      workerNameText === undefined
        ? `WORKER_NAME is not set, and the host name '${workerName}' is not a name the backend accepts (${rule}): ` +
            'set WORKER_NAME'
        : `WORKER_NAME must be ${rule}, not '${workerName}'`,
    )
  }

  const modeText = required('RECORDER_MODE', MODES.join(' or '))
  const mode = MODES.find((candidate) => candidate === modeText)
  if (modeText !== '' && mode === undefined) {
    problems.push(`RECORDER_MODE must be ${MODES.join(' or ')}, not '${modeText}'`)
  }

  const qualities: Quality[] = []
  const labels = (text('QUALITIES') ?? QUALITIES.join(',')).split(',').map((part) => part.trim())
  for (const label of labels.filter((part) => part !== '')) {
    const quality = QUALITIES.find((candidate) => candidate === label)
    if (quality === undefined) {
      problems.push(`QUALITIES holds '${label}', which is not a quality: use ${QUALITIES.join(' and ')}`)
    } else if (!qualities.includes(quality)) {
      qualities.push(quality)
    }
  }
  if (qualities.length === 0 && problems.every((problem) => !problem.startsWith('QUALITIES'))) {
    problems.push(`QUALITIES names no quality: use ${QUALITIES.join(' and ')}`)
  }

  const fakeSpeedText = text('FAKE_SPEED')
  const fakeSpeed = fakeSpeedText === undefined ? 1 : Number(fakeSpeedText)
  if (!Number.isFinite(fakeSpeed) || fakeSpeed < 0) {
    problems.push(`FAKE_SPEED must be a number of at least 0 (0 is as fast as possible), not '${fakeSpeedText}'`)
  }

  const factorText = text('CSDM_TIMEOUT_FACTOR')
  const csdmTimeoutFactor = factorText === undefined ? 6 : Number(factorText)
  if (!Number.isFinite(csdmTimeoutFactor) || csdmTimeoutFactor < 1 || csdmTimeoutFactor > 100) {
    problems.push(`CSDM_TIMEOUT_FACTOR must be a number from 1 to 100, not '${factorText}'`)
  }

  const workDir = resolve(text('WORK_DIR') ?? './work')
  const csdmMode = mode === 'csdm'
  const csdmPath = text('CSDM_PATH') ?? defaultCsdmPath(env) ?? ''
  const cs2Path = text('CS2_PATH')
  if (csdmMode) {
    problems.push(...csdmProblems(csdmPath, text('CSDM_PATH') !== undefined, workDir, cs2Path))
  }

  const config: Config = {
    backendUrl,
    workerToken,
    workerName,
    mode: mode ?? 'fake',
    workDir,
    pollSeconds: seconds('POLL_SECONDS', 5, 1),
    heartbeatSeconds: seconds('HEARTBEAT_SECONDS', 30, 1),
    demoCacheItems: wholeNumber('DEMO_CACHE_ITEMS', 5, 1),
    qualities,
    ffmpegPath: text('FFMPEG_PATH') ?? (csdmMode ? join(csdmToolsFolder(), 'ffmpeg.exe') : 'ffmpeg'),
    ffprobePath: text('FFPROBE_PATH') ?? (csdmMode ? join(csdmToolsFolder(), 'ffprobe.exe') : 'ffprobe'),
    errorBackoffSeconds: seconds('ERROR_BACKOFF_SECONDS', 300, 0),
    fakeSpeed,
    csdmPath,
    csdmMinTimeoutSeconds: seconds('CSDM_MIN_TIMEOUT_SECONDS', 600, 60),
    csdmTimeoutFactor,
    csdmPlaybackStartSeconds: seconds('CSDM_PLAYBACK_START_SECONDS', 180, 0),
    cs2Path,
  }
  if (problems.length > 0) {
    throw new ConfigError(problems)
  }
  return config
}

/**
 * What stands in the way of recording with the game on this machine: it is not Windows (CS2 with HLAE runs there only),
 * CS Demo Manager is not where `CSDM_PATH` (or its default) says, the work directory has a `#` in it (CS Demo Manager
 * strips `#...` from its configuration file as a comment, also inside a path), or `CS2_PATH` is not a CS2 folder.
 */
function csdmProblems(csdmPath: string, given: boolean, workDir: string, cs2Path: string | undefined): string[] {
  const problems: string[] = []
  if (process.platform !== 'win32') {
    problems.push(
      `RECORDER_MODE=csdm records with CS2, HLAE and CS Demo Manager, which run on Windows only; this machine is ` +
        `${process.platform}. RECORDER_MODE=fake records a test pattern instead.`,
    )
  }
  if (csdmPath === '') {
    problems.push(
      'CSDM_PATH is required: the csdm.cmd of CS Demo Manager, normally ' +
        '%LOCALAPPDATA%\\Programs\\cs-demo-manager\\csdm.cmd (LOCALAPPDATA is not set here, so there is no default)',
    )
  } else {
    const { executable, archive } = csdmCommand(csdmPath)
    if (!existsSync(executable) || !existsSync(archive)) {
      problems.push(
        `${given ? 'CSDM_PATH' : 'CSDM_PATH is not set, and the default'} '${csdmPath}' is not CS Demo Manager's ` +
          `csdm.cmd (cs-demo-manager.exe and resources\\app.asar are not beside it): install CS Demo Manager, or set ` +
          'CSDM_PATH to the csdm.cmd in its install folder',
      )
    }
  }
  if (workDir.includes('#')) {
    problems.push(
      `WORK_DIR '${workDir}' has a '#' in it, which CS Demo Manager cuts out of its configuration file as a comment: ` +
        'choose a folder without one, such as C:\\csfaceit\\work',
    )
  }
  if (cs2Path !== undefined && !existsSync(join(cs2Path, 'game', 'bin', 'win64', 'cs2.exe'))) {
    problems.push(
      `CS2_PATH '${cs2Path}' is not the folder of CS2 (game\\bin\\win64\\cs2.exe is not in it): give the ` +
        "'Counter-Strike Global Offensive' folder of the Steam library, or leave CS2_PATH out to have Steam asked",
    )
  }
  return problems
}

/** The address with no trailing slash, or a problem when it is not an http(s) address. */
function backendUrlOf(raw: string, problems: string[]): string {
  if (raw === '') {
    return ''
  }
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href.replace(/\/+$/, '')
    }
  } catch {
    // Reported below, together with an address of another kind.
  }
  problems.push(`BACKEND_URL must be an http or https address, such as http://backend:8080, not '${raw}'`)
  return ''
}
