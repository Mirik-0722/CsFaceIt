import { Fragment } from 'react'

// The stretches of the track that go into the video, as where each starts and ends, and the kills inside it, all in
// percent of the track. A made-up match: seven stretches round the 12 kills of one player.
const SEGMENTS = [
  { from: 4, to: 13, kills: [7, 10] },
  { from: 19, to: 24, kills: [21.5] },
  { from: 31, to: 43, kills: [34, 37, 40] },
  { from: 50, to: 55, kills: [52.5] },
  { from: 61, to: 74, kills: [64, 68, 71] },
  { from: 80, to: 85, kills: [82.5] },
  { from: 90, to: 97, kills: [93.5] },
]

/**
 * What a compilation cuts, as a line (mockup, screen 1): the track is the match, the windows are the stretches that
 * are kept, each round its kills, and the bare track between them is the idle time that is cut. It is drawn like
 * `KillTimeline`, which shows one window on its track; this shows several, for the landing page only. Like that line it
 * is a picture of what is said in words beside it, so it is hidden from screen readers.
 */
export default function CompilationLine() {
  return (
    <div aria-hidden="true" className="relative h-4">
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-line-strong" />
      {SEGMENTS.map((segment) => (
        <Fragment key={segment.from}>
          <div
            className="absolute inset-y-0 border-x-2 border-foreground bg-foreground/8"
            style={{ left: `${segment.from}%`, width: `${segment.to - segment.from}%` }}
          />
          {segment.kills.map((kill) => (
            <div
              key={kill}
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-rec"
              style={{ left: `${kill}%` }}
            />
          ))}
        </Fragment>
      ))}
    </div>
  )
}
