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
import { playerPath } from '@/lib/matchSource'
import { cn } from '@/lib/utils'
import type { HighlightResponse } from '@/api/types'

// A side is shown as its letters in its own colour, so the colour is never the only sign.
const SIDE_CLASS: Record<string, string> = { CT: 'text-side-ct', T: 'text-side-t' }

/**
 * The nickname, as a link to the profile; a player the backend knows only from the demo has one as well
 * (`/players/steam:<SteamID>`, answered from the database).
 */
function PlayerName({ highlight }: { highlight: HighlightResponse }) {
  return (
    // 44px tall for the finger; the negative margin keeps the line where a plain 24px line would be. That box reaches
    // into the rows above and below, so the focus ring is drawn around the name itself, not around the box. On a phone
    // it is lifted over the row's link to the match, which a row of a list that spans matches stretches over itself.
    <Link
      to={playerPath(highlight.playerId)}
      className="group/name -my-2.5 inline-flex min-h-11 max-w-full items-center underline-offset-4 outline-none hover:underline max-md:relative max-md:z-10"
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
 *
 * Under `md` the same elements are a row of a list (phone spec 5.1): the strip is a 112×64 picture at the left, the
 * round, the player and the details stand beside it on three lines, and the place at the right end, 44px square, holds
 * the action (whose own phone look is the slot's, `data-row-action`) or, in a list that spans matches, the link to the
 * match as a `›`, stretched over the row, with the match's map and day as a fourth line. The line of the round is
 * left out.
 */
export default function HighlightCard({ highlight, showMatch, action }: HighlightCardProps) {
  const t = useT()
  const locale = useLocale()
  const sideClass = highlight.side ? SIDE_CLASS[highlight.side] : undefined
  const map = mapLabel(highlight.mapName) ?? t.match.unknownMap
  return (
    <article className="flex h-full flex-col gap-3.5 border border-border bg-card p-4.5 transition-colors hover:border-line-strong max-md:relative max-md:isolate max-md:grid max-md:min-h-[85px] max-md:grid-cols-[minmax(0,1fr)_auto] max-md:content-center max-md:gap-x-3 max-md:gap-y-0 max-md:border-x-0 max-md:border-t-0 max-md:bg-transparent max-md:py-2.5 max-md:pr-0 max-md:pl-[124px]">
      {/* The strip of the map at the top, edge to edge, with the tag and the duration on it, each on a fill of its own.
          On a phone, the picture at the left of the row: the tag in its top left corner, the duration in the bottom
          right one. */}
      <div className="relative isolate -mx-4.5 -mt-4.5 flex h-16 items-end justify-between gap-3 px-3 pb-2.5 max-md:absolute max-md:top-2.5 max-md:left-0 max-md:mx-0 max-md:mt-0 max-md:w-28 max-md:flex-col max-md:items-start max-md:gap-0 max-md:p-1.5">
        <CardScenery mapName={highlight.mapName} roundNumber={highlight.roundNumber} />
        {/* The labels are written as they are shown (`1v3 CLUTCH`), so the tag leaves their case alone. */}
        <HighlightTag
          type={highlight.type}
          onPicture
          className="max-md:h-4 max-md:px-1 max-md:text-[9px]"
        />
        <span className="inline-flex h-6 items-center bg-background/80 px-1.5 font-mono text-xs text-foreground tabular-nums max-md:h-4 max-md:self-end max-md:px-1 max-md:text-[10px]">
          <span className="sr-only">{t.highlight.duration}</span> {formatDuration(highlight.durationSeconds)}
        </span>
      </div>
      <span className="label-mono -mb-1.5 min-w-0 truncate max-md:col-start-1 max-md:mb-0 max-md:text-[10px]">
        {t.highlight.round(highlight.roundNumber)}
        {sideClass && (
          <>
            {' · '}
            <span className={sideClass}>{highlight.side}</span>
          </>
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 max-md:col-start-1 max-md:gap-0">
        <h3 className="min-w-0 text-[17px] leading-[1.4] font-semibold max-md:text-[15px]">
          <PlayerName highlight={highlight} />
        </h3>
        <p className="text-[13px] text-muted-foreground max-md:truncate max-md:text-xs">
          {describeHighlight(highlight, t)}
        </p>
      </div>
      {/* On a phone the line of the match is the `›` at the end of the row: its map and day are a fourth line, for the
          eye only (the link's own name says them). */}
      {showMatch && (
        <p
          aria-hidden="true"
          className="truncate font-mono text-[10px] tracking-[0.08em] text-subtle uppercase max-md:col-start-1 md:hidden"
        >
          {map}
          {highlight.startedAt && ` · ${formatDate(highlight.startedAt, locale)}`}
        </p>
      )}
      {/* The line of the round keeps 3px of air above and below its 16px window, as the design draws it. */}
      <div className="py-[3px] max-md:hidden">
        <KillTimeline
          start={highlight.roundStartTick}
          end={highlight.roundEndTick}
          windowStart={highlight.tickStart}
          windowEnd={highlight.tickEnd}
          marks={highlight.kills.map((kill) => kill.tick)}
        />
      </div>
      {action && (
        <div
          data-row-action
          className="mt-auto flex min-h-11 min-w-0 items-center gap-3 max-md:col-start-2 max-md:row-span-2 max-md:row-start-1 max-md:mt-0 max-md:min-w-11 max-md:justify-center max-md:gap-0 max-md:self-center"
        >
          {action}
        </div>
      )}
      {showMatch && (
        // The last row of the card, edge to edge; without an action row above it, it is what is pushed to the bottom.
        // On a phone, the 44px `›` at the end of the row, its map and day said to a screen reader only, and the whole
        // row is the link (the name of the player is lifted over it).
        <Link
          to={`/matches/${encodeURIComponent(highlight.matchId)}`}
          className={cn(
            '-mx-4.5 -mb-4.5 flex min-h-11 items-center gap-3 border-t border-border px-4.5 text-[13px] text-muted-foreground -outline-offset-2 hover:bg-secondary',
            'max-md:col-start-2 max-md:row-span-3 max-md:row-start-1 max-md:mx-0 max-md:mb-0 max-md:size-11 max-md:justify-center max-md:gap-0 max-md:self-center max-md:border-t-0 max-md:px-0 max-md:after:absolute max-md:after:inset-0 max-md:after:content-[""]',
            !action && 'mt-auto max-md:mt-0',
          )}
        >
          {/* The map's emblem, 20px, before its name; a map without one is the name alone. */}
          <span className="flex min-w-0 items-center gap-2 max-md:sr-only">
            <MapEmblem mapName={highlight.mapName} size={20} fallback="none" />
            <span className="min-w-0 truncate">{map}</span>
          </span>
          {highlight.startedAt && (
            <time dateTime={highlight.startedAt} className="shrink-0 font-mono text-xs text-subtle max-md:sr-only">
              {formatDate(highlight.startedAt, locale)}
            </time>
          )}
          <ChevronRight aria-hidden="true" className="ml-auto size-4 shrink-0 text-subtle max-md:ml-0 max-md:size-5" />
        </Link>
      )}
    </article>
  )
}
