import { cn } from '@/lib/utils'

/** The side of a player in a round. */
type Side = 'CT' | 'T'

// The kill feed of the game colours a name by the side it is on; `HighlightCard` does the same for the side letters.
const SIDE_CLASS: Record<Side, string> = { CT: 'text-side-ct', T: 'text-side-t' }

interface KillFeedRowProps {
  killer: string
  killerSide: Side
  /** The weapon as it is shown (`AK-47`). */
  weapon: string
  /** Draws the mark between the weapon and the victim. */
  headshot?: boolean
  victim: string
  victimSide: Side
  className?: string
}

/**
 * One line of the kill feed of the game (spec 3), the way the game draws it over the picture: the killer, the weapon,
 * a mark when it was a headshot, the victim, in mono on an 80% dark ground with a 1px red border. It is a picture of
 * the overlay, not a list of facts about a clip (the clip page has its own list of kills), so it is hidden from screen
 * readers and its colours are the game's. The size is 12px unless `className` says otherwise: a frame too narrow for
 * that makes it smaller.
 */
export default function KillFeedRow({
  killer,
  killerSide,
  weapon,
  headshot,
  victim,
  victimSide,
  className,
}: KillFeedRowProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex items-center gap-2 border border-rec bg-background/80 px-2 py-0.5 font-mono text-xs whitespace-nowrap',
        className,
      )}
    >
      <span className={SIDE_CLASS[killerSide]}>{killer}</span>
      <span className="text-muted-foreground">{weapon}</span>
      {headshot && (
        // A ring with a dot in it, the mark of a headshot in the game's own kill feed.
        <svg viewBox="0 0 12 12" className="size-2.75 shrink-0 text-foreground">
          <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="6" cy="6" r="1.4" fill="currentColor" />
        </svg>
      )}
      <span className={SIDE_CLASS[victimSide]}>{victim}</span>
    </div>
  )
}
