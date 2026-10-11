interface KillTimelineProps {
  /** The ticks the track runs between. */
  start: number
  end: number
  /** The clip window, inside the track. */
  windowStart: number
  windowEnd: number
  /** The ticks of the kills. */
  marks: number[]
}

/**
 * A round as a line (spec 3): a 2px track, the clip window on it and a red mark per kill. It is a picture of what the
 * card beside it says in words (the kills, the duration), so it is hidden from screen readers.
 */
export default function KillTimeline({ start, end, windowStart, windowEnd, marks }: KillTimelineProps) {
  const span = end - start
  // Where a tick is on the track, in percent; a tick outside the track sits on its end.
  const at = (tick: number) => Math.min(100, Math.max(0, ((tick - start) / span) * 100))
  return (
    <div aria-hidden="true" className="relative h-4">
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-line-strong" />
      {/* Ticks that do not make a track (a round that ends where it starts) leave the bare line. */}
      {span > 0 && (
        <>
          <div
            className="absolute inset-y-0 min-w-1 border-x-2 border-foreground bg-foreground/8"
            style={{ left: `${at(windowStart)}%`, width: `${at(windowEnd) - at(windowStart)}%` }}
          />
          {marks.map((tick, index) => (
            // Two kills can share a tick, so the position in the list is the key.
            <div
              key={index}
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-rec"
              style={{ left: `${at(tick)}%` }}
            />
          ))}
        </>
      )}
    </div>
  )
}
