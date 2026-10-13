import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import HighlightTag from '@/components/HighlightTag'
import KillTimeline from '@/components/KillTimeline'
import MapEmblem from '@/components/MapEmblem'
import { useLocale, useT } from '@/i18n'
import { formatDate } from '@/lib/formatDate'
import { describeHighlight, formatDuration } from '@/lib/highlightLabels'
import { mapSceneryUrl } from '@/lib/mapArt'
import { mapLabel, mapScene } from '@/lib/mapTint'
import { cn } from '@/lib/utils'
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
 * The strip of scenery behind the top of a card: the small view of the map, under a veil in the card's colour that
 * closes towards the card. Each round shows another part of the picture, so that the cards of one match differ. A map
 * without a view (or no map) gets its tint. Decoration: the tag and the duration on it say what matters.
 */
function CardScenery({ mapName, roundNumber }: { mapName: string | null; roundNumber: number }) {
  const view = mapSceneryUrl(mapName, 'small')
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {view ? (
        <img
          src={view}
          alt=""
          decoding="async"
          loading="lazy"
          className="size-full object-cover"
          // The strip is far wider than tall, so the picture is cut above and below: the round picks the band of it.
          style={{ objectPosition: `50% ${15 + ((roundNumber * 37) % 70)}%` }}
        />
      ) : (
        <div
          className="size-full"
          style={{ backgroundImage: `radial-gradient(90% 120% at 35% 30%, ${mapScene(mapName)} 0%, #15130F 60%, #0E1013 100%)` }}
        />
      )}
      <div className="scenery-veil-card absolute inset-0" />
    </div>
  )
}

interface HighlightCardProps {
  highlight: HighlightResponse
  showMatch: boolean
  /** The action or the state of the highlight's clip, as a row under the line of the round. */
  action?: ReactNode
}

/**
 * One highlight (spec 3): a strip of the map's scenery with its tag (in the colour of its family; only ACE is filled)
 * and how long the clip would be on it, then the round and the side, how long the clip would be, who did it
 * and with what, and the round as a line with the clip window and the kills on it. `action` adds a row for what can be
 * done about the highlight; `showMatch` adds a row that links to the match, for lists that span several matches. The
 * rows sit at the bottom of the card, also when a neighbour makes the card taller.
 */
export default function HighlightCard({ highlight, showMatch, action }: HighlightCardProps) {
  const t = useT()
  const locale = useLocale()
  const sideClass = highlight.side ? SIDE_CLASS[highlight.side] : undefined
  return (
    <article className="flex h-full flex-col gap-3.5 border border-border bg-card p-4.5 transition-colors hover:border-line-strong">
      {/* The strip of the map at the top, edge to edge, with the tag and the duration on it, each on a fill of its own. */}
      <div className="relative isolate -mx-4.5 -mt-4.5 flex h-16 items-end justify-between gap-3 px-3 pb-2.5">
        <CardScenery mapName={highlight.mapName} roundNumber={highlight.roundNumber} />
        {/* The labels are written as they are shown (`1v3 CLUTCH`), so the tag leaves their case alone. */}
        <HighlightTag type={highlight.type} onPicture />
        <span className="inline-flex h-6 items-center bg-background/80 px-1.5 font-mono text-xs text-foreground tabular-nums">
          <span className="sr-only">{t.highlight.duration}</span> {formatDuration(highlight.durationSeconds)}
        </span>
      </div>
      <span className="label-mono -mb-1.5 min-w-0 truncate">
        {t.highlight.round(highlight.roundNumber)}
        {sideClass && (
          <>
            {' · '}
            <span className={sideClass}>{highlight.side}</span>
          </>
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="min-w-0 text-[17px] leading-[1.4] font-semibold">
          <PlayerName highlight={highlight} />
        </h3>
        <p className="text-[13px] text-muted-foreground">{describeHighlight(highlight, t)}</p>
      </div>
      {/* The line of the round keeps 3px of air above and below its 16px window, as the design draws it. */}
      <div className="py-[3px]">
        <KillTimeline
          start={highlight.roundStartTick}
          end={highlight.roundEndTick}
          windowStart={highlight.tickStart}
          windowEnd={highlight.tickEnd}
          marks={highlight.kills.map((kill) => kill.tick)}
        />
      </div>
      {action && <div className="mt-auto flex min-h-11 min-w-0 items-center gap-3">{action}</div>}
      {showMatch && (
        // The last row of the card, edge to edge; without an action row above it, it is what is pushed to the bottom.
        <Link
          to={`/matches/${encodeURIComponent(highlight.matchId)}`}
          className={cn(
            '-mx-4.5 -mb-4.5 flex min-h-11 items-center gap-3 border-t border-border px-4.5 text-[13px] text-muted-foreground -outline-offset-2 hover:bg-secondary',
            !action && 'mt-auto',
          )}
        >
          {/* The map's emblem, 20px, before its name; a map without one is the name alone. */}
          <span className="flex min-w-0 items-center gap-2">
            <MapEmblem mapName={highlight.mapName} size={20} fallback="none" />
            <span className="min-w-0 truncate">{mapLabel(highlight.mapName) ?? t.match.unknownMap}</span>
          </span>
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
