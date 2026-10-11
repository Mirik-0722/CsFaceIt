import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import KillTimeline from '@/components/KillTimeline'
import { Badge } from '@/components/ui/badge'
import { useLocale, useT } from '@/i18n'
import { formatDate } from '@/lib/formatDate'
import { describeHighlight, formatDuration, highlightLabel } from '@/lib/highlightLabels'
import { mapLabel } from '@/lib/mapTint'
import type { HighlightResponse } from '@/api/types'

// A side is shown as its letters in its own colour, so the colour is never the only sign.
const SIDE_CLASS: Record<string, string> = { CT: 'text-side-ct', T: 'text-side-t' }

/** The nickname, as a link to the profile. A player the backend knows only from the demo has no profile to link to. */
function PlayerName({ highlight }: { highlight: HighlightResponse }) {
  if (highlight.playerId.startsWith('steam:')) {
    return <span className="block truncate">{highlight.nickname}</span>
  }
  return (
    // 44px tall for the finger; the negative margin keeps the line where a plain 24px line would be. That box reaches
    // into the rows above and below, so the focus ring is drawn around the name itself, not around the box.
    <Link
      to={`/players/${encodeURIComponent(highlight.playerId)}`}
      className="group/name -my-2.5 inline-flex min-h-11 max-w-full items-center underline-offset-4 outline-none hover:underline"
    >
      <span className="truncate group-focus-visible/name:outline-2 group-focus-visible/name:outline-offset-2">
        {highlight.nickname}
      </span>
    </Link>
  )
}

/**
 * One highlight (spec 3): its tag (only ACE is filled), the round and the side, how long the clip would be, who did it
 * and with what, and the round as a line with the clip window and the kills on it. `showMatch` adds a row that links
 * to the match, for lists that span several matches.
 */
export default function HighlightCard({ highlight, showMatch }: { highlight: HighlightResponse; showMatch: boolean }) {
  const t = useT()
  const locale = useLocale()
  const sideClass = highlight.side ? SIDE_CLASS[highlight.side] : undefined
  return (
    <article className="flex h-full flex-col gap-3 border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        {/* The labels are written as they are shown (`1v3 CLUTCH`), so the tag leaves their case alone. */}
        <Badge variant={highlight.type === 'ACE' ? 'default' : 'outline'} className="normal-case">
          {highlightLabel(highlight.type, t)}
        </Badge>
        <span className="label-mono min-w-0 truncate">
          {t.highlight.round(highlight.roundNumber)}
          {sideClass && (
            <>
              {' · '}
              <span className={sideClass}>{highlight.side}</span>
            </>
          )}
        </span>
        <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
          <span className="sr-only">{t.highlight.duration}</span> {formatDuration(highlight.durationSeconds)}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="min-w-0 text-[17px] leading-[1.4] font-semibold">
          <PlayerName highlight={highlight} />
        </h3>
        <p className="text-[13px] text-muted-foreground">{describeHighlight(highlight, t)}</p>
      </div>
      <KillTimeline
        start={highlight.roundStartTick}
        end={highlight.roundEndTick}
        windowStart={highlight.tickStart}
        windowEnd={highlight.tickEnd}
        marks={highlight.kills.map((kill) => kill.tick)}
      />
      {showMatch && (
        // The last row of the card, edge to edge, pushed to the bottom when a neighbour makes the card taller.
        <Link
          to={`/matches/${encodeURIComponent(highlight.matchId)}`}
          className="-mx-4 mt-auto -mb-4 flex min-h-11 items-center gap-3 border-t border-border px-4 text-[13px] text-muted-foreground -outline-offset-2 hover:bg-secondary"
        >
          <span className="min-w-0 truncate">{mapLabel(highlight.mapName) ?? t.match.unknownMap}</span>
          {highlight.startedAt && (
            <time dateTime={highlight.startedAt} className="shrink-0 font-mono text-xs text-subtle">
              {formatDate(highlight.startedAt, locale)}
            </time>
          )}
          <ChevronRight aria-hidden="true" className="ml-auto size-4 shrink-0 text-subtle" />
        </Link>
      )}
    </article>
  )
}
