interface KillTimelineProps {
  /** The values the track runs between: the ticks of a round, or the milliseconds of a video. */
  start: number
  end: number
  /** The clip window, inside the track; left out when the track is the clip itself. */
  windowStart?: number
  windowEnd?: number
  /** Where the kills are on the track. */
  marks: number[]
  /** Makes the marks clickable: called with the position of the mark that was clicked. */
  onSeek?: (position: number) => void
}

/**
 * A stretch of play as a line (spec 3): a 2px track and a red mark per kill. It has two uses. On a highlight card the
 * track is the round and the clip window is drawn on it. Under a video the track is the video itself, from its first
 * millisecond to its last, and a click on a mark takes the video there. Either way it is a picture of what is said in
 * words beside it (the kills of the card, the list of kills of the clip, whose rows seek as well), so it is hidden
 * from screen readers and its marks are not reached with the keyboard.
 */
export default function KillTimeline({ start, end, windowStart, windowEnd, marks, onSeek }: KillTimelineProps) {
  const span = end - start
  // Where a value is on the track, in percent; a value outside the track sits on its end.
  const at = (value: number) => Math.min(100, Math.max(0, ((value - start) / span) * 100))
  return (
    <div aria-hidden="true" className={onSeek ? 'relative h-6' : 'relative h-4'}>
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-line-strong" />
      {/* Values that do not make a track (a round that ends where it starts) leave the bare line. */}
      {span > 0 && (
        <>
          {windowStart !== undefined && windowEnd !== undefined && (
            <div
              className="absolute inset-y-0 min-w-1 border-x-2 border-foreground bg-foreground/8"
              style={{ left: `${at(windowStart)}%`, width: `${at(windowEnd) - at(windowStart)}%` }}
            />
          )}
          {marks.map((mark, index) =>
            onSeek ? (
              // Wider than the line it draws, so that it can be hit with a pointer.
              <button
                key={index}
                type="button"
                tabIndex={-1}
                onClick={() => onSeek(mark)}
                className="group/mark absolute inset-y-0 flex w-4 -translate-x-1/2 cursor-pointer justify-center"
                style={{ left: `${at(mark)}%` }}
              >
                <span className="h-full w-0.5 bg-rec group-hover/mark:w-1" />
              </button>
            ) : (
              // Two kills can share a tick, so the position in the list is the key.
              <div
                key={index}
                className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-rec"
                style={{ left: `${at(mark)}%` }}
              />
            ),
          )}
        </>
      )}
    </div>
  )
}
