import { WORKER_TOKEN_VARIABLE } from './config.js'
import { RecorderError } from './recorders/recorder.js'

/**
 * The machine the recorder runs on, as the recorder sees it: what counts as a fault of the machine itself (as against
 * a fault of a clip), and what the processes it starts get of its environment. One place decides both, so that every
 * recorder (the fake one, and the one that drives the game) draws the same lines.
 */

/**
 * The reason sent to the backend when the disk of the machine is the matter, whichever file it was and wherever it
 * happened. A fixed text, since the page of the clip shows it to every visitor: no path of this machine is in it.
 */
export const MACHINE_REASON = 'The recorder could not write its files'

/**
 * The system errors of the recorder's own file work (the directory of a clip, its thumbnail, the demo cache, the
 * temporary files) that are the machine's: no room left, a disk that may not be written to, no permission. Another
 * clip would meet the same, so the recorder pauses after one (`RecorderError.environment`).
 */
const MACHINE_CODES: ReadonlySet<string> = new Set(['ENOSPC', 'EROFS', 'EACCES', 'EPERM'])

/** What a tool says of the same: the words of the system's own messages for those errors. */
const MACHINE_OUTPUT = /No space left on device|Permission denied|Read-only file system/i

/** Whether a system error code is one of the machine's. */
export function isMachineCode(code: unknown): boolean {
  return typeof code === 'string' && MACHINE_CODES.has(code)
}

/**
 * The failure to report for an error of the recorder's own file work, wherever it came from, when that error is the
 * machine's; `undefined` when it is not. The system's message, which has the path in it, is the detail for the log.
 */
export function machineFault(error: unknown): RecorderError | undefined {
  if (!isMachineCode((error as NodeJS.ErrnoException | null | undefined)?.code)) {
    return undefined
  }
  const message = error instanceof Error ? error.message : String(error)
  return new RecorderError(MACHINE_REASON, true, { environment: true, detail: message })
}

/**
 * The failure to report for a tool (ffmpeg, ffprobe) that ended with an error when its output says that the disk is
 * full or that a file may not be written; `undefined` when it says nothing of the kind. `detail` is what the log gets.
 */
export function machineFaultInOutput(output: string, detail: string): RecorderError | undefined {
  return MACHINE_OUTPUT.test(output)
    ? new RecorderError(MACHINE_REASON, true, { environment: true, detail })
    : undefined
}

/**
 * The environment of a process the recorder starts (ffmpeg, ffprobe, and later the game and its tools): that of the
 * recorder without the worker token. The token opens the worker API, which no tool has any business with, and a
 * process that prints its environment, or dumps it when it crashes, would give the secret to a log or a report.
 */
export function childEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  for (const name of Object.keys(environment)) {
    // Names are not case sensitive on Windows, where a variable may be set as `Clip_Worker_Token`.
    if (name.toUpperCase() === WORKER_TOKEN_VARIABLE) {
      delete environment[name]
    }
  }
  return environment
}
