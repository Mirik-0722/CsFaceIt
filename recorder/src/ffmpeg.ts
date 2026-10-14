import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Config } from './config.js'
import { childEnvironment, machineFaultInOutput } from './machine.js'
import { RecorderError } from './recorders/recorder.js'

/** How much of ffmpeg's own complaint is kept as the detail of a failure: it goes to the log, never to the backend. */
const STDERR_TAIL_LENGTH = 600

/**
 * Runs ffmpeg to its end, telling `onPercent` how far it is. The arguments must send the progress to the standard
 * output (`-progress pipe:1`), a block of `key=value` lines about twice a second, and `totalSeconds` is how long the
 * output will be. When `signal` aborts the process is killed at once, and what the abort means is left to the caller.
 *
 * `cwd` is the directory ffmpeg runs in. A filter that names a file (`fontfile=`, `textfile=`) takes a path that is
 * relative to it, which spares the escaping that a Windows path (`C:\...`) needs inside a filter graph.
 */
export function runFfmpeg(
  config: Config,
  args: string[],
  totalSeconds: number,
  onPercent: (percent: number) => void,
  signal: AbortSignal,
  cwd?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // An abort that came while the caller was getting ready would never reach the listener below.
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const child = spawn(config.ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: childEnvironment(),
      ...(cwd === undefined ? {} : { cwd }),
    })
    let complaint = ''
    let percent = -1
    const report = (value: number) => {
      const clamped = Math.max(0, Math.min(100, Math.floor(value)))
      if (clamped !== percent) {
        percent = clamped
        onPercent(clamped)
      }
    }
    report(0)

    // `out_time_ms` is in microseconds, like `out_time_us`, for historical reasons; either does.
    createInterface({ input: child.stdout }).on('line', (line) => {
      const [key, value] = line.split('=', 2)
      if (key === 'out_time_us' || key === 'out_time_ms') {
        const microseconds = Number(value)
        if (Number.isFinite(microseconds)) {
          report((microseconds / (totalSeconds * 1_000_000)) * 100)
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      complaint = (complaint + chunk.toString()).slice(-STDERR_TAIL_LENGTH)
    })

    const kill = () => child.kill('SIGKILL')
    signal.addEventListener('abort', kill, { once: true })
    child.once('error', (error: NodeJS.ErrnoException) => {
      signal.removeEventListener('abort', kill)
      const detail =
        error.code === 'ENOENT'
          ? `${config.ffmpegPath} is not there: set FFMPEG_PATH, or install ffmpeg`
          : error.message
      reject(new RecorderError('ffmpeg could not be started', true, { environment: true, detail }))
    })
    child.once('close', (code, killedBy) => {
      signal.removeEventListener('abort', kill)
      if (signal.aborted) {
        reject(signal.reason)
      } else if (code === 0) {
        report(100)
        resolve()
      } else {
        const how = code === null ? `was killed by ${killedBy}` : `exited with code ${code}`
        const output = complaint.trim()
        // A tool that says the disk is full, or that it may not write, is reporting the machine and not the clip.
        reject(
          machineFaultInOutput(output, `ffmpeg ${how}: ${output}`) ??
            new RecorderError(`ffmpeg ${how}`, true, { detail: output }),
        )
      }
    })
  })
}
