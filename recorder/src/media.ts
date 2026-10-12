import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { RecorderError } from './recorders/recorder.js'

const execFileAsync = promisify(execFile)

/** What the backend is told when a clip is finished (`CompleteRequest`), and the size of the file that was sent. */
export interface Probe {
  durationMs: number
  width: number
  height: number
  sizeBytes: number
}

export interface Media {
  /** The length and the picture size of a video, read from the file itself by ffprobe, never taken on trust. */
  probe(path: string, signal?: AbortSignal): Promise<Probe>
  /** Writes a JPEG, 640 pixels wide, of the frame one second into the video (its first frame if it is shorter). */
  thumbnail(path: string, outPath: string, signal?: AbortSignal): Promise<void>
}

/** The width of a thumbnail; the height follows from the picture, rounded to an even number. */
const THUMBNAIL_WIDTH = 640
/** Where in the video the thumbnail is taken, in seconds: past the first frame, which is often black. */
const THUMBNAIL_AT_SECONDS = 1
/** Neither tool has anything to do for more than a moment on a clip; one that hangs is killed. */
const TOOL_TIMEOUT_MS = 120_000
/** How much of ffmpeg's complaint is kept for a message. */
const STDERR_TAIL_LENGTH = 500

export function createMedia(ffmpegPath: string, ffprobePath: string): Media {
  return {
    async probe(path, signal) {
      const output = await run(ffprobePath, [
        '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path,
      ], signal)
      const { format, streams } = parseProbe(output)
      const video = streams.find((stream) => stream.codec_type === 'video')
      const seconds = Number(format.duration)
      if (video?.width === undefined || video.height === undefined || !Number.isFinite(seconds) || seconds <= 0) {
        throw new RecorderError('The recording is not a video with a length and a picture', true, {
          detail: `ffprobe found no video stream or no duration in ${basename(path)}`,
        })
      }
      return {
        // The backend wants a positive number of milliseconds; a clip too short to round to one is one millisecond.
        durationMs: Math.max(1, Math.round(seconds * 1000)),
        width: video.width,
        height: video.height,
        sizeBytes: (await stat(path)).size,
      }
    },

    async thumbnail(path, outPath, signal) {
      let lastError: unknown
      // A video shorter than that point has no frame there and ffmpeg writes nothing, so the first frame is taken.
      for (const at of [THUMBNAIL_AT_SECONDS, 0]) {
        try {
          await run(ffmpegPath, [
            '-v', 'error', '-y', '-ss', String(at), '-i', path,
            '-frames:v', '1', '-vf', `scale=${THUMBNAIL_WIDTH}:-2`, '-q:v', '3', outPath,
          ], signal)
          if ((await stat(outPath).catch(() => undefined))?.size) {
            return
          }
        } catch (error) {
          if (signal?.aborted || (error instanceof RecorderError && error.environment)) {
            throw error
          }
          lastError = error
        }
      }
      throw (
        lastError ??
        new RecorderError('No thumbnail could be made from the recording', true, {
          detail: `ffmpeg wrote no frame of ${basename(path)}`,
        })
      )
    },
  }
}

interface ProbeOutput {
  format: { duration?: string }
  streams: { codec_type?: string; width?: number; height?: number }[]
}

function parseProbe(output: string): ProbeOutput {
  try {
    const parsed = JSON.parse(output) as Partial<ProbeOutput>
    return { format: parsed.format ?? {}, streams: parsed.streams ?? [] }
  } catch {
    throw new RecorderError('ffprobe could not read the recording', true, { detail: 'ffprobe did not answer with JSON' })
  }
}

/** Runs a tool to its end and returns what it wrote to the standard output. */
async function run(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      ...(signal === undefined ? {} : { signal }),
      timeout: TOOL_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason
    }
    throw toolError(command, error)
  }
}

/**
 * Says what went wrong with a tool: it is not there (the machine's fault), it hung, or it complained. The message is
 * only the name of the tool and what happened to it; the path of the tool and what it said go in the detail.
 */
function toolError(command: string, error: unknown): RecorderError {
  const failure = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string }
  const tool = basename(command)
  if (failure.code === 'ENOENT') {
    return new RecorderError(`${tool} could not be started`, true, {
      environment: true,
      detail: `${command} is not there: set FFMPEG_PATH and FFPROBE_PATH, or install ffmpeg`,
    })
  }
  if (failure.killed) {
    return new RecorderError(`${tool} did not finish in time`, true, {
      detail: `${command} was killed after ${TOOL_TIMEOUT_MS / 1000} s`,
    })
  }
  const complaint = (failure.stderr ?? failure.message).trim().slice(-STDERR_TAIL_LENGTH)
  const message = typeof failure.code === 'number' ? `${tool} exited with code ${failure.code}` : `${tool} failed`
  return new RecorderError(message, true, { detail: complaint })
}
