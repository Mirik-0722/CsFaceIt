import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import HighlightTag from '@/components/HighlightTag'
import { MatchMapCell } from '@/components/MatchesTable'
import { Badge } from '@/components/ui/badge'
import { useLocale, useT } from '@/i18n'
import { formatDate } from '@/lib/formatDate'
import { formatScore } from '@/lib/formatScore'
import { kindText, summarizeHighlights } from '@/lib/matchHighlights'
import { mapLabel } from '@/lib/mapTint'
import { RESULT_ROW } from '@/lib/resultRow'
import { cn } from '@/lib/utils'
import type { PlayerMatchResponse } from '@/api/overview'
import type { MatchResult, MatchSummary } from '@/api/types'

/**
 * What the site knows of the matches of the history (the player's stored matches, `GET /players/{id}/matches`): the
 * history comes from FACEIT and knows no map. `pending` while that list is on its way; `ready` once it is there, with
 * the stored matches by `matchId` (a match of the history that is not among them has no known map).
 */
export interface MatchDetails {
  state: 'pending' | 'ready'
  matches: ReadonlyMap<string, PlayerMatchResponse>
}

/** The result as a word in its colour; an unknown result is a neutral dash that screen readers hear in words. */
function Result({ result }: { result: MatchResult }) {
  const t = useT()
  switch (result) {
    case 'WIN':
      return <span className="text-sm font-semibold text-positive">{t.matchList.win}</span>
    case 'LOSS':
      return <span className="text-sm font-semibold text-negative">{t.matchList.loss}</span>
    default:
      return (
        <Badge variant="secondary">
          <span aria-hidden="true">—</span>
          <span className="sr-only">{t.matchList.unknown}</span>
        </Badge>
      )
  }
}

/** The player's kills, deaths and assists: the figures for the eye, in words for those who hear them. */
function Kda({ match }: { match: PlayerMatchResponse | undefined }) {
  const t = useT()
  if (!match || match.kills === null || match.deaths === null || match.assists === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t.statsCards.noData}</span>
      </>
    )
  }
  return (
    <>
      <span aria-hidden="true">{`${match.kills} / ${match.deaths} / ${match.assists}`}</span>
      <span className="sr-only">{t.lively.kda(match.kills, match.deaths, match.assists)}</span>
    </>
  )
}

/** The strongest highlight of an analyzed match as its tag; nothing for a match without one. */
function TopHighlight({ match }: { match: PlayerMatchResponse | undefined }) {
  const t = useT()
  if (!match || match.demoStatus !== 'ANALYZED') {
    return null
  }
  const { top } = summarizeHighlights(match.highlights, t)
  return top ? <HighlightTag type={top.type}>{kindText(top, t)}</HighlightTag> : null
}

// The columns of a row that knows its match (spec 3, the profile's history row): the map, from `md` K / D / A, from
// `lg` the strongest highlight, the result, the score and the arrow. A cell that is hidden below its width takes no
// column. The row starts 14px in: 3px of it is the bar of the result.
const DETAILED =
  'grid min-h-16 grid-cols-[minmax(0,1fr)_auto_auto_16px] items-center gap-4 pr-2 pl-3.5 md:grid-cols-[minmax(0,1fr)_7.5rem_auto_auto_16px] lg:grid-cols-[minmax(0,1fr)_7.5rem_11rem_auto_auto_16px]'
// A row whose match the site cannot look up (the stored matches failed): the date, the result, the score and the arrow.
const PLAIN =
  'grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 pr-2 pl-3.5 sm:grid-cols-[9rem_minmax(0,1fr)_auto_auto]'

/**
 * A player's matches, one link per row to the match page; the whole row is the link, so its name carries the score,
 * which ends it. With `details` a row is drawn as a row of the matches table (`MatchesTable`): the map's emblem, its
 * name and under it the `FACEIT` tag with the date, the figures and the strongest highlight. While the details are on
 * their way the map's place is kept (the emblem's square, no name); without them (their request failed) the rows keep
 * the date and the result only.
 */
export default function MatchList({ items, details }: { items: MatchSummary[]; details?: MatchDetails }) {
  const t = useT()
  const locale = useLocale()
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.matchList.empty}</p>
  }
  return (
    <ul className="border-t border-border">
      {items.map((match) => {
        const date = formatDate(match.startedAt, locale)
        const score = (
          <span className="font-mono text-[19px] leading-none font-semibold tabular-nums">
            {formatScore(match.score, match.result)}
          </span>
        )
        const arrow = <ChevronRight aria-hidden="true" className="size-4 text-subtle" />
        if (!details) {
          return (
            <li key={match.matchId} className="border-b border-border">
              <Link
                to={`/matches/${encodeURIComponent(match.matchId)}`}
                className={cn(PLAIN, 'hover:bg-secondary', RESULT_ROW[match.result])}
              >
                <time dateTime={match.startedAt} className="font-mono text-xs text-subtle">
                  {date}
                </time>
                <Result result={match.result} />
                {score}
                {arrow}
              </Link>
            </li>
          )
        }
        const known = details.state === 'ready'
        const stored = details.matches.get(match.matchId)
        return (
          <li key={match.matchId} className="border-b border-border">
            <Link
              to={`/matches/${encodeURIComponent(match.matchId)}`}
              className={cn(DETAILED, 'hover:bg-secondary', RESULT_ROW[match.result])}
            >
              <MatchMapCell
                mapName={stored?.mapName ?? null}
                name={known ? (mapLabel(stored?.mapName ?? null) ?? t.match.unknownMap) : null}
                date={date}
                startedAt={match.startedAt}
              />
              <span className="hidden font-mono text-sm md:block">{known && <Kda match={stored} />}</span>
              <span className="hidden min-w-0 items-center lg:flex">{known && <TopHighlight match={stored} />}</span>
              <Result result={match.result} />
              {score}
              {arrow}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
