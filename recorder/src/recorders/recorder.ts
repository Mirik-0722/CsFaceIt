import type { Stage, WorkerJob } from '../api.js'

/**
 * What turns a job into a video: the fake recorder makes a test pattern with ffmpeg, the Windows one will drive the
 * game. The loop in `job.ts` knows nothing of which one it has; it hands over the job and the demo and takes back a
 * file, so everything that is true of only one of them stays in its own file.
 */
export interface Recorder {
  /**
   * Records the segments of the job one after the other as one MP4 file (H.264 `yuv420p`, AAC, `+faststart`) in
   * `outDir`, which is the clip's own scratch directory and is emptied after the clip, and returns its path.
   *
   * `onProgress` takes the percent of the recording done, 0 to 100, as often as the recorder knows it. The loop sends
   * the latest value to the backend on a timer of its own, so a recorder reports as it pleases and never has to think
   * about the backend. A recorder that encodes in a later step of its own may report the stage `ENCODING`.
   *
   * When `signal` aborts, the recorder stops what it runs at once (kills the child process) and rejects; the loop
   * decides what the abort means, so the rejection carries nothing in particular.
   *
   * @throws RecorderError the recording did not work out
   */
  record(
    job: WorkerJob,
    demoPath: string,
    outDir: string,
    onProgress: (stage: Stage, percent: number) => void,
    signal: AbortSignal,
  ): Promise<string>
}

/** What a `RecorderError` says besides its message and whether trying again can help. */
export interface RecorderErrorOptions {
  /** The failure is of the machine and not of the clip (see below). */
  environment?: boolean
  /** What went wrong in detail: paths, system messages, the output of a tool. For the log of the recorder only. */
  detail?: string
}

/**
 * A recording that did not work out, and what the backend should do about it. `retryable` says that another attempt
 * may do better (the game crashed, a timeout), which puts the clip back in the queue while it has attempts left; a
 * clip that cannot be recorded at all (the demo is of a game version nobody can play any more) is not retryable and
 * ends as `FAILED`.
 *
 * The `message` is sent to the backend as the reason of the failure, and the page of the clip shows it to every
 * visitor. It is therefore a short reason that anyone may read ("ffmpeg exited with code 1", "The demo file is no
 * longer stored"): no path of this machine, no stack, no setting, no output of a tool. Whatever helps the operator
 * goes in `options.detail`, which is written to the log of the recorder and never sent.
 *
 * `options.environment` marks a failure of the machine and not of the clip: ffmpeg or the game would not start, the
 * disk is full. The recorder then takes no new clip for `ERROR_BACKOFF_SECONDS`, because the next clip would fail the
 * same way at once and each failed attempt is one of the few the clips have.
 */
export class RecorderError extends Error {
  readonly retryable: boolean
  readonly environment: boolean
  readonly detail: string | undefined

  constructor(message: string, retryable: boolean, options: RecorderErrorOptions = {}) {
    super(message)
    this.name = 'RecorderError'
    this.retryable = retryable
    this.environment = options.environment ?? false
    this.detail = options.detail
  }
}
