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
  UNKNOWN: 'border-line-strong',
}

/**
 * The newest ten matches as ten squares, the newest first (spec 3): how the player has been doing lately, in the header
 * of the profile. It is a picture, so it has one name that says the same in words (and the squares are hidden from
 * assistive technology). Nothing is drawn for a player without a match; with fewer than ten, the label counts them.
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
    <div className="flex flex-col gap-2">
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
