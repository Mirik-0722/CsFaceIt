import { copyFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { introSeconds, SLOW_MO_FACTOR, type Stage, type WorkerJob } from '../api.js'
import type { Config } from '../config.js'
import { runFfmpeg } from '../ffmpeg.js'
import { log } from '../log.js'
import type { Media, Streams } from '../media.js'
import { CARD_WITHOUT_TITLE, fixed, montageText, TITLE_MAX_LENGTH, type Lettering } from '../montage.js'
import { RecorderError } from './recorder.js'

/** A keyframe every two seconds keeps seeking in a browser quick. */
const KEYFRAME_EVERY_SECONDS = 2
/** The quality of an encoded clip: x264's constant rate factor, a little better than CS Demo Manager's 23. */
const VIDEO_CRF = 20
const AUDIO_RATE = 48_000
const AUDIO_BITRATE = '160k'
/**
 * The typefaces the title is written in, the first one found in the fonts of Windows: Arial Bold is on every Windows
 * and has Latin (Uzbek included) and Cyrillic letters.
 */
const FONTS = ['arialbd.ttf', 'arial.ttf', 'segoeuib.ttf', 'segoeui.ttf']
/**
 * The words reach drawtext as files and the typeface as a file, both by a name relative to the directory ffmpeg runs
 * in (the clip's own): a file takes any character a title may have, and neither a quote of the title nor the colon of
 * a Windows path has to be escaped in the filter graph.
 */
const FILES: Lettering = {
  font: 'fontfile=font.ttf',
  // Arial Bold is wider than monospace on average for capitals: a long title is set a little smaller.
  advance: 0.62,
  words: (slot) => `textfile=${slot}.txt`,
}

/**
 * Makes the video of a clip out of its recordings, one per segment in the order of the job, as H.264 `yuv420p` and
 * AAC with `+faststart`, at the job's size and frame rate:
 *
 * - When nothing has to change (no slow motion, no other picture, no title or intro) and the recordings are H.264
 *   `yuv420p` with AAC, they are only joined, the streams copied (`-c copy`) and the index moved to the front.
 * - Otherwise everything is encoded once: a slow-motion segment is played at half speed (`setpts`, and `atempo` for its
 *   sound), a picture of another shape is cut to the job's shape around its centre and scaled (a 9:16 clip is the
 *   middle of a 16:9 recording), an intro is a black card of `INTRO_SECONDS` before the first segment, and the title
 *   is written on the frames (see `montage.ts`). A recording without sound gets silence of its length.
 *
 * Music is not mixed in: a job names its track by an id of the backend's `clip.music-tracks`, and no audio file comes
 * with it (see the README).
 */
export async function assemble(
  config: Config,
  media: Media,
  job: WorkerJob,
  recordings: string[],
  outDir: string,
  onProgress: (stage: Stage, percent: number) => void,
  signal: AbortSignal,
): Promise<string> {
  const streams: Streams[] = []
  for (const recording of recordings) {
    streams.push(await media.streams(recording, signal))
  }
  const out = join(outDir, `clip-${job.clipId}.mp4`)
  const title = job.title === null ? null : shownTitle(job.title)
  const slow = job.segments.some((segment) => segment.slowMo)
  const reshaped = streams.some((stream) => stream.video?.width !== job.width || stream.video.height !== job.height)
  const decorated = title !== null || job.intro
  const servable = streams.every(
    (stream) =>
      stream.video?.codec === 'h264' && stream.video.pixelFormat === 'yuv420p' && stream.audio?.codec === 'aac',
  )
  const report = (percent: number) => onProgress('ENCODING', percent)

  if (!slow && !reshaped && !decorated && servable) {
    log.info(`Clip ${job.clipId}: joining ${recordings.length} recording(s) as they are (H.264, AAC)`)
    const list = recordings.map((recording) => `file '${recording.replace(/'/g, "'\\''")}'`).join('\n')
    await writeFile(join(outDir, 'recordings.txt'), `${list}\n`)
    const seconds = streams.reduce((sum, stream) => sum + stream.seconds, 0)
    await runFfmpeg(
      config,
      [
        ...COMMON,
        '-f', 'concat', '-safe', '0', '-i', 'recordings.txt',
        '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart',
        out,
      ],
      seconds,
      report,
      signal,
      outDir,
    )
    return out
  }

  const why = [
    slow ? 'slow motion' : '',
    reshaped ? `a ${job.width}x${job.height} picture` : '',
    decorated ? 'a title or an intro' : '',
    servable ? '' : 'codecs a browser may not play',
  ].filter((reason) => reason !== '')
  log.info(`Clip ${job.clipId}: encoding ${recordings.length} recording(s) into one video for ${why.join(', ')}`)
  if (decorated) {
    await prepareLettering(outDir, title)
  }
  const { args, seconds } = encoding(job, recordings, streams, title, out)
  await runFfmpeg(config, args, seconds, report, signal, outDir)
  return out
}

/** What every run of ffmpeg here starts with: quiet, no questions, and the progress on the standard output. */
const COMMON = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-nostats', '-y', '-progress', 'pipe:1']

/**
 * The title as it is shown: control characters gone, runs of white space made one space, cut to `TITLE_MAX_LENGTH`
 * characters (not UTF-16 units, so that no letter is cut in half); `null` when nothing is left.
 */
function shownTitle(title: string): string | null {
  const clean = title.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()
  const shown = Array.from(clean).slice(0, TITLE_MAX_LENGTH).join('')
  return shown === '' ? null : shown
}

/** Writes the two texts and copies the typeface into the clip's directory, where `FILES` finds them. */
async function prepareLettering(outDir: string, title: string | null): Promise<void> {
  const fonts = join(process.env.WINDIR ?? process.env.SystemRoot ?? 'C:\\Windows', 'Fonts')
  let font: string | undefined
  for (const name of FONTS) {
    if ((await stat(join(fonts, name)).catch(() => undefined))?.isFile()) {
      font = join(fonts, name)
      break
    }
  }
  if (font === undefined) {
    throw new RecorderError('The recorder has no font to write the title with', true, {
      environment: true,
      detail: `none of ${FONTS.join(', ')} is in ${fonts}`,
    })
  }
  await copyFile(font, join(outDir, 'font.ttf'))
  await writeFile(join(outDir, 'card.txt'), title ?? CARD_WITHOUT_TITLE, 'utf8')
  await writeFile(join(outDir, 'title.txt'), title ?? '', 'utf8')
}

/** The arguments of the encoding run, and how long its output is in seconds (for the percent). */
function encoding(
  job: WorkerJob,
  recordings: string[],
  streams: Streams[],
  title: string | null,
  out: string,
): { args: string[]; seconds: number } {
  const { width, height, fps } = job
  // The recordings are inputs 0 to n - 1, in the order of the job; the intro's two sources, when there is one, follow.
  const inputs = recordings.flatMap((recording) => ['-i', recording])
  const graph: string[] = []
  const parts: string[] = []
  let seconds = 0

  const intro = introSeconds(job)
  if (intro > 0) {
    const card = recordings.length
    inputs.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${fixed(intro)}`)
    inputs.push('-f', 'lavfi', '-i', `anullsrc=r=${AUDIO_RATE}:cl=stereo`)
    graph.push(`[${card}:v]setsar=1,format=yuv420p[vintro]`)
    graph.push(`[${card + 1}:a]atrim=duration=${fixed(intro)},asetpts=PTS-STARTPTS,${AUDIO_FORMAT}[aintro]`)
    parts.push('[vintro][aintro]')
    seconds += intro
  }

  for (const index of recordings.keys()) {
    const stream = streams[index]
    const segment = job.segments[index]
    if (stream?.video === undefined || segment === undefined) {
      throw new RecorderError('A recording of the clip could not be read', true, {
        detail: `recording ${index + 1} of ${recordings.length} has no video stream or no segment`,
      })
    }
    const speed = segment.slowMo ? SLOW_MO_FACTOR : 1
    const video = [`setpts=${speed}*(PTS-STARTPTS)`]
    const crop = cropTo(stream.video.width, stream.video.height, width, height)
    if (crop !== undefined) {
      video.push(crop)
    }
    video.push(`scale=${width}:${height}`, 'setsar=1', `fps=${fps}`, 'format=yuv420p')
    graph.push(`[${index}:v]${video.join(',')}[v${index}]`)
    const tempo = speed === 1 ? '' : `,atempo=${1 / speed}`
    graph.push(
      stream.audio === undefined
        ? `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${fixed(stream.seconds * speed)},${AUDIO_FORMAT}[a${index}]`
        : `[${index}:a]asetpts=PTS-STARTPTS,${AUDIO_FORMAT}${tempo}[a${index}]`,
    )
    parts.push(`[v${index}][a${index}]`)
    seconds += stream.seconds * speed
  }

  graph.push(`${parts.join('')}concat=n=${parts.length}:v=1:a=1[vjoined][aout]`)
  const text = montageText(job, title, FILES)
  graph.push(`[vjoined]${text.length === 0 ? 'null' : text.join(',')}[vout]`)

  return {
    args: [
      ...COMMON,
      ...inputs,
      '-filter_complex', graph.join(';'),
      '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(VIDEO_CRF), '-pix_fmt', 'yuv420p',
      '-g', String(fps * KEYFRAME_EVERY_SECONDS), '-r', String(fps),
      '-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ac', '2',
      '-movflags', '+faststart',
      out,
    ],
    seconds,
  }
}

/** Every part's sound in one form, so that the parts can be joined: 48 kHz stereo, planar float. */
const AUDIO_FORMAT = `aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`

/**
 * The crop that gives a picture of `sourceWidth` x `sourceHeight` the shape of `width` x `height`, around its centre
 * (crop's default), on even sides; `undefined` when the shapes are the same to the pixel.
 */
function cropTo(sourceWidth: number, sourceHeight: number, width: number, height: number): string | undefined {
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2)
  if (sourceWidth * height === sourceHeight * width) {
    return undefined
  }
  if (sourceWidth * height > sourceHeight * width) {
    // Wider than wanted: keep the full height and the middle of the width (a 9:16 clip of a 16:9 recording).
    return `crop=${even((sourceHeight * width) / height)}:${sourceHeight}`
  }
  return `crop=${sourceWidth}:${even((sourceWidth * height) / width)}`
}
