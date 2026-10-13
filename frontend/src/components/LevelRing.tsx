import { cn } from '@/lib/utils'

// The ring is drawn in a 32-unit box whatever its size on the screen, so the stroke grows and shrinks with it: 2.5px
// at 20px, 4px at 32px, which leaves room for the two digits of "10" inside.
const SIZE_CLASS = { 20: 'size-5 text-[9px]', 32: 'size-8 text-[13px]' }

/** FACEIT's colour of a level (the `--level-*` tokens, named after the lowest level of their range). */
function arcClass(level: number): string {
  if (level >= 10) {
    return 'stroke-level-10'
  }
  if (level >= 8) {
    return 'stroke-level-8'
  }
  if (level >= 4) {
    return 'stroke-level-4'
  }
  return level >= 2 ? 'stroke-level-2' : 'stroke-level-1'
}

interface LevelRingProps {
  /** FACEIT's skill level, 1 to 10; null (a player without CS2 data) or any other number draws nothing. */
  level: number | null
  size: keyof typeof SIZE_CLASS
  className?: string
}

/**
 * A FACEIT skill level as the ring players know it: a dim track, an arc in the level's colour that covers level/10 of
 * the circle from the top, clockwise, and the level in the middle. It is decoration beside the text that already names
 * the level, so it is hidden from assistive technology. The number is in the text colour, not in the level's: some of
 * FACEIT's colours (the red of level 10) would fall short of 4.5:1 for a small text on a picture.
 */
export default function LevelRing({ level, size, className }: LevelRingProps) {
  if (level === null || !Number.isInteger(level) || level < 1 || level > 10) {
    return null
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center font-mono leading-none font-bold tabular-nums',
        SIZE_CLASS[size],
        className,
      )}
    >
      {/* Turned a quarter back, so that the arc starts at the top instead of at three o'clock. */}
      <svg viewBox="0 0 32 32" fill="none" strokeWidth="4" className="absolute inset-0 size-full -rotate-90">
        <circle cx="16" cy="16" r="14" className="stroke-line-strong" />
        {/* `pathLength` makes the dash a share of the circle: the arc is level × 10 of its 100 units. */}
        <circle
          cx="16"
          cy="16"
          r="14"
          pathLength="100"
          strokeDasharray={`${level * 10} 100`}
          className={arcClass(level)}
        />
      </svg>
      {level}
    </span>
  )
}
