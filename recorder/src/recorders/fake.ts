import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { videoSeconds, type WorkerJob } from '../api.js'
import type { Config } from '../config.js'
import { log } from '../log.js'
import { childEnvironment, machineFaultInOutput } from '../machine.js'
import { RecorderError, type Recorder } from './recorder.js'

/** How much of ffmpeg's own complaint is kept as the detail of a failure: it goes to the log, never to the backend. */
const STDERR_TAIL_LENGTH = 600
/** The tone under the pattern; the sine is mixed down so that nobody who plays a fake clip is startled. */
const TONE_HZ = 330
const TONE_VOLUME = 0.2
/** A keyframe every two seconds keeps seeking in a browser quick. */
const KEYFRAME_EVERY_SECONDS = 2

/**
 * Makes the video of a clip without a game: ffmpeg's test pattern at the size and frame rate of the job, with a tone,
 * as long as the segments add up to, with the clip, the player and the tick of the demo written on the frames. It
 * exists so that the whole chain, from the queue to the player in the browser, can be built and tried on any machine.
 * Because the tick is on the frames, the marks of the kills on the clip page can be checked by looking at where they
 * take the video.
 *
 * It paces itself like a recording does: `FAKE_SPEED` seconds of video per second of wall time (1 is real time, 0 is
 * as fast as ffmpeg can go). Without that a clip of ten seconds would be done in a fraction of one, and neither its
 * states nor a recorder that dies "while it records" could be seen.
 */
export function createFakeRecorder(config: Config): Recorder {
  return {
    async record(job, demoPath, outDir, onProgress, signal) {
      const seconds = videoSeconds(job)
      if (seconds <= 0) {
        throw new RecorderError('The segments of the job add up to no time at all', false)
      }
      if (job.width % 2 !== 0 || job.height % 2 !== 0) {
        throw new RecorderError(`H.264 needs a picture of even sides, not ${job.width}x${job.height}`, false)
      }
      signal.throwIfAborted()
      await mkdir(outDir, { recursive: true })
      const out = join(outDir, `clip-${job.clipId}.mp4`)
      const speed = config.fakeSpeed === 0 ? 'unlimited' : String(config.fakeSpeed)
      log.info(
        `Fake recording of clip ${job.clipId}: ${seconds.toFixed(1)} s at ${job.width}x${job.height}, ` +
          `${job.fps} fps, speed ${speed} (the demo ${demoPath} is not played)`,
      )
      const args = argumentsFor(config, job, seconds, out)
      await runFfmpeg(config, args, seconds, (percent) => onProgress('RECORDING', percent), signal)
      return out
    },
  }
}

function argumentsFor(config: Config, job: WorkerJob, seconds: number, out: string): string[] {
  // `-readrate` holds ffmpeg to that many seconds of input per second of the clock, `-re` being 1.
  const pace = config.fakeSpeed === 0 ? [] : ['-readrate', String(config.fakeSpeed)]
  const length = fixed(seconds)
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-nostats', '-y',
    // The progress goes to the standard output, a block of `key=value` lines about twice a second.
    '-progress', 'pipe:1',
    ...pace, '-f', 'lavfi', '-i', `testsrc2=size=${job.width}x${job.height}:rate=${job.fps}:duration=${length}`,
    ...pace, '-f', 'lavfi', '-i', `sine=frequency=${TONE_HZ}:sample_rate=48000:duration=${length}`,
    '-vf', overlay(job),
    '-af', `volume=${TONE_VOLUME}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
    '-g', String(job.fps * KEYFRAME_EVERY_SECONDS),
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    '-t', length,
    out,
  ]
}

/**
 * The text on the frames: the clip and the player in a corner, and at the bottom which segment is on and the tick of
 * the demo the frame stands for, worked out from the segment's first tick and the time into it. What is written comes
 * from the backend, so it is cut down to harmless characters; nothing in the filter has to be escaped for it.
 */
function overlay(job: WorkerJob): string {
  const size = Math.round(job.height / 20)
  const lineHeight = Math.round(size * 1.6)
  const style = (color: string) =>
    [
      'font=monospace',
      `fontsize=${size}`,
      `fontcolor=${color}`,
      'box=1',
      'boxcolor=black@0.6',
      `boxborderw=${Math.round(size / 3)}`,
      `x=${size}`,
    ].join(':')
  const corner = [`CLIP ${job.clipId} ${plain(job.kind)}`, `STEAM ${plain(job.focusSteamId)}`].map(
    (line, index) => `drawtext=${style('white')}:y=${size + index * lineHeight}:expansion=none:text='${line}'`,
  )
  let start = 0
  const ticks = job.segments.map((segment, index) => {
    const from = start
    start += (segment.endTick - segment.startTick) / job.tickRate
    const label = `SEG ${index + 1}/${job.segments.length} tick `
    // `\:` is how a colon is written inside the `%{...}` of drawtext, whose arguments are separated by colons.
    const tick = `%{eif\\:${segment.startTick}+(t-${fixed(from)})*${job.tickRate}\\:d}`
    // On for the time of the segment, from its start up to the start of the next one.
    const on = `enable='gte(t,${fixed(from)})*lt(t,${fixed(start)})'`
    return `drawtext=${style('yellow')}:y=h-th-${size}:${on}:text='${label}${tick}'`
  })
  return [...corner, ...ticks].join(',')
}

/** Keeps letters, digits, spaces, dashes and underscores: all the overlay needs of a value it did not make itself. */
function plain(value: string): string {
  return value.replace(/[^A-Za-z0-9 _-]/g, '?').slice(0, 40)
}

/** A time in seconds as ffmpeg's expressions take it: plain decimals, never an exponent. */
function fixed(value: number): string {
  return value.toFixed(6)
}

/**
 * Runs ffmpeg to its end, telling `onPercent` how far it is (from its own progress output). When `signal` aborts the
 * process is killed at once, and what the abort means is left to the caller.
 */
function runFfmpeg(
  config: Config,
  args: string[],
  totalSeconds: number,
  onPercent: (percent: number) => void,
  signal: AbortSignal,
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
