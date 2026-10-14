import { introSeconds, type WorkerJob } from './api.js'

/**
 * The words a montage puts on its frames, the same for every recorder: an intro card of `INTRO_SECONDS` that shows the
 * title (or `CARD_WITHOUT_TITLE`) in the middle of a black picture, and the title centred on the top line for the rest
 * of the video. The fake recorder draws them on its test pattern, the game recorder on the recording; only the
 * typeface and the way the words reach ffmpeg differ, which is what `Lettering` says.
 */

/** The longest title of a montage, as the backend allows it. */
export const TITLE_MAX_LENGTH = 60
/** What the intro card says when the montage has no title. */
export const CARD_WITHOUT_TITLE = 'MONTAGE'

/** How ffmpeg's drawtext is told the typeface and the words. */
export interface Lettering {
  /** The option that chooses the typeface: `font=monospace` (looked up by fontconfig) or `fontfile=font.ttf`. */
  font: string
  /** How wide a character is on average, as a share of the font size: a long title is set smaller to stay on the frame. */
  advance: number
  /** The option that carries the words, `text='...'` or `textfile=...`; `slot` says which of the two texts it is. */
  words(slot: 'card' | 'title', value: string): string
}

/** The size of the text of a clip: it follows the shorter side, so that a 9:16 picture holds it as a 16:9 one does. */
export function textSize(job: WorkerJob): number {
  return Math.round(Math.min(job.width, job.height) / 20)
}

/** A time in seconds as ffmpeg's expressions take it: plain decimals, never an exponent. */
export function fixed(value: number): string {
  return value.toFixed(6)
}

/**
 * The drawbox and drawtext filters of the intro card and the title of `job`; none for a clip without either. What a
 * filter after them draws is on top of the black card. `title` is the title as it is to be shown, already cut to
 * `TITLE_MAX_LENGTH` and made safe for `lettering`; `null` for none.
 */
export function montageText(job: WorkerJob, title: string | null, lettering: Lettering): string[] {
  const size = textSize(job)
  const box = ['box=1', 'boxcolor=black@0.6', `boxborderw=${Math.round(size / 3)}`]
  const fitting = (text: string, preferred: number) =>
    Math.max(8, Math.min(preferred, Math.floor((job.width * 0.9) / (lettering.advance * Math.max(1, text.length)))))
  const intro = introSeconds(job)
  const filters: string[] = []

  if (intro > 0) {
    const card = title ?? CARD_WITHOUT_TITLE
    const on = `enable='lt(t,${fixed(intro)})'`
    filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:${on}`)
    filters.push(
      `drawtext=${lettering.font}:fontsize=${fitting(card, size * 2)}:fontcolor=white:x=(w-text_w)/2:` +
        `y=(h-text_h)/2:${on}:expansion=none:${lettering.words('card', card)}`,
    )
  }
  if (title !== null) {
    // After the intro, so that the card shows the title once, in the middle.
    const on = `enable='gte(t,${fixed(intro)})'`
    filters.push(
      `drawtext=${lettering.font}:fontsize=${fitting(title, size)}:fontcolor=white:${box.join(':')}:` +
        `x=(w-text_w)/2:y=${size}:${on}:expansion=none:${lettering.words('title', title)}`,
    )
  }
  return filters
}
