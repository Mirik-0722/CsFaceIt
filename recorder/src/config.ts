import { hostname } from 'node:os'
import { resolve } from 'node:path'

/** The sizes of picture the backend knows, as it writes them (`ClipQuality`); a recorder says which it can record. */
export const QUALITIES = ['720p', '1080p'] as const
export type Quality = (typeof QUALITIES)[number]

/** How the clips are recorded: `fake` is a test pattern made by ffmpeg, `csdm` plays the game with CS Demo Manager. */
export const MODES = ['fake', 'csdm'] as const
export type Mode = (typeof MODES)[number]

/** The longest name the backend keeps for a recorder (`WorkerLimits.NAME`); a longer one is refused as invalid. */
const MAX_NAME_LENGTH = 64

export interface Config {
  /** Where the backend is, without a trailing slash: the recorder only ever calls `/api/worker/v1/**` there. */
  backendUrl: string
  /** The secret of the worker API. Never logged, never put in a message. */
  workerToken: string
  workerName: string
  mode: Mode
  /** An absolute path: the demo cache is `<workDir>/demos`, the scratch directory of each clip `<workDir>/jobs`. */
  workDir: string
  pollSeconds: number
  heartbeatSeconds: number
  demoCacheItems: number
  qualities: Quality[]
  ffmpegPath: string
  ffprobePath: string
  /** How long the recorder takes no new clip after an error of its own machine (see `RecorderError.environment`). */
  errorBackoffSeconds: number
  /** Seconds of video the fake recorder makes per second of wall time; 0 is as fast as ffmpeg goes. */
  fakeSpeed: number
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
  const wholeNumber = (name: string, fallback: number, min: number): number => {
    const raw = text(name)
    if (raw === undefined) {
      return fallback
    }
    if (!/^\d{1,9}$/.test(raw) || Number(raw) < min) {
      problems.push(`${name} must be a whole number of at least ${min}, not '${raw}'`)
      return fallback
    }
    return Number(raw)
  }

  const backendUrl = backendUrlOf(
    required('BACKEND_URL', 'the address of the backend, such as http://backend:8080'),
    problems,
  )
  // The value is not repeated in a problem: it is a secret.
  const workerToken = required('CLIP_WORKER_TOKEN', 'the secret the backend was started with')

  const workerName = text('WORKER_NAME') ?? hostname()
  if (workerName.length === 0 || workerName.length > MAX_NAME_LENGTH) {
    problems.push(`WORKER_NAME must be 1 to ${MAX_NAME_LENGTH} characters (the host name is the default)`)
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

  const config: Config = {
    backendUrl,
    workerToken,
    workerName,
    mode: mode ?? 'fake',
    workDir: resolve(text('WORK_DIR') ?? './work'),
    pollSeconds: wholeNumber('POLL_SECONDS', 5, 1),
    heartbeatSeconds: wholeNumber('HEARTBEAT_SECONDS', 30, 1),
    demoCacheItems: wholeNumber('DEMO_CACHE_ITEMS', 5, 1),
    qualities,
    ffmpegPath: text('FFMPEG_PATH') ?? 'ffmpeg',
    ffprobePath: text('FFPROBE_PATH') ?? 'ffprobe',
    errorBackoffSeconds: wholeNumber('ERROR_BACKOFF_SECONDS', 300, 0),
    fakeSpeed,
  }
  if (problems.length > 0) {
    throw new ConfigError(problems)
  }
  return config
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
