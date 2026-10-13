import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { MatchResult, MatchSummary } from '@/api/types'

/** How many of the newest matches the strip draws. */
const STRIP_LENGTH = 10

// A win is a filled square in the positive colour, a loss an outline in the negative one; a match whose result could not
// be told is an outline in neither, so that it is not counted as either.
const SQUARE: Record<MatchResult, string> = {
  WIN: 'border-positive bg-positive',
  LOSS: 'border-negative',
  UNKNOWN: 'border-ring',
}

/**
 * The newest ten matches as ten squares, the newest first (spec 3): how the player has been doing lately, in the header
 * of the profile. It is a picture, so it has one name that says the same in words (and the squares are hidden from
 * assistive technology). Nothing is drawn for a player without a match; with fewer than ten, the label counts them.
 *
 * Over the scenery of the header (the header marks that with `data-scenery="shown"`) the strip stands on a dark plate of
 * its own, so that its label and squares keep their contrast on any map. The plate's 12px (1px of line and 11px of
 * padding, the line transparent until the picture comes, so that it fades in with the fill) are there with or without
 * the scenery, so the strip does not move when the picture comes; the negative margins give that room back: above and
 * below at every width, and at the sides under `sm` too, where the strip mostly drops under the name and its label
 * must line up with the avatar's edge (the plate then reaches 12px into the page's gutter). From `sm` up the strip
 * sits 12px in from the column's right edge instead.
 */
export default function FormStrip({ matches }: { matches: MatchSummary[] }) {
  const t = useT()
  const newest = matches.slice(0, STRIP_LENGTH)
  if (newest.length === 0) {
    return null
  }
  const wins = newest.filter((match) => match.result === 'WIN').length
  const losses = newest.filter((match) => match.result === 'LOSS').length
  return (
    <div className="-my-3 flex flex-col gap-2 border border-transparent p-[11px] transition-colors duration-700 group-data-[scenery=shown]/head:border-border group-data-[scenery=shown]/head:bg-card/92 max-sm:-mx-3 motion-reduce:transition-none">
      {/* The name below starts with the same words. */}
      <span aria-hidden="true" className="label-mono">
        {t.matches.form.label(newest.length)}
      </span>
      <div
        role="img"
        aria-label={t.matches.form.name(newest.length, wins, losses, newest.length - wins - losses)}
        className="flex gap-1.5"
      >
        {newest.map((match) => (
          <span key={match.matchId} className={cn('block size-4 border', SQUARE[match.result])} />
        ))}
      </div>
    </div>
  )
}
