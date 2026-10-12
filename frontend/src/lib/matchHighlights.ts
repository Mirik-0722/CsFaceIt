import type { Messages } from '@/i18n'
import type { HighlightCount } from '@/api/overview'
import type { HighlightType } from '@/api/types'
import { highlightGroup, highlightLabel } from '@/lib/highlightLabels'

/**
 * The kinds of highlight from the one that stands out most to the one that stands out least. An ace and a four-kill are
 * the top; a clutch is rarer than a triple kill, and the bigger the clutch the rarer; the special kills come last.
 */
const BY_STRENGTH: readonly HighlightType[] = [
  'ACE',
  'K4',
  'CLUTCH_1V5',
  'CLUTCH_1V4',
  'CLUTCH_1V3',
  'CLUTCH_1V2',
  'CLUTCH_1V1',
  'K3',
  'NINJA_DEFUSE',
  'NO_SCOPE',
  'WALLBANG',
  'SMOKE_KILL',
  'KNIFE_KILL',
]

/** How many kinds are named after the strongest one in a table row; the others are counted (`+2`). */
const LISTED = 3

function withCount(label: string, count: number): string {
  return count > 1 ? `${label} ×${count}` : label
}

/** A kind of highlight and how often it happened, as a tag shows it: `ACE`, `3K ×2`, `1v3 CLUTCH`. */
export function kindText({ type, count }: HighlightCount, t: Messages): string {
  return withCount(highlightLabel(type, t), count)
}

/** A kind as a word in a line of text: the same, but a clutch is only its size (`1v3`), since the line is no tag. */
function shortKindText({ type, count }: HighlightCount, t: Messages): string {
  const clutchSize = highlightGroup(type) === 'clutch' ? type.slice('CLUTCH_'.length).toLowerCase() : null
  return withCount(clutchSize ?? highlightLabel(type, t), count)
}

/**
 * What a match's highlights come to in a table row: the kind that stands out most (the tag), and the next ones as one
 * line of text, `1v3 · 3K ×2 · +1`, which names at most three and counts the rest. `top` is null without a highlight.
 * A kind with a count of zero is not there.
 */
export function summarizeHighlights(
  highlights: HighlightCount[],
  t: Messages,
): { top: HighlightCount | null; rest: string } {
  const present = highlights
    .filter((kind) => kind.count > 0)
    .sort((a, b) => BY_STRENGTH.indexOf(a.type) - BY_STRENGTH.indexOf(b.type))
  const [top = null, ...others] = present
  const named = others.slice(0, LISTED).map((kind) => shortKindText(kind, t))
  const hidden = others.length - named.length
  return { top, rest: [...named, ...(hidden > 0 ? [`+${hidden}`] : [])].join(' · ') }
}
