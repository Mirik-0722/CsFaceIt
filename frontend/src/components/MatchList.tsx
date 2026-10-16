import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import HighlightTag from '@/components/HighlightTag'
import { MatchMapCell } from '@/components/MatchesTable'
import PhoneHighlightTags from '@/components/PhoneHighlightTags'
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
function Result({ result, className }: { result: MatchResult; className?: string }) {
  const t = useT()
  switch (result) {
    case 'WIN':
      return <span className={cn('text-sm font-semibold text-positive', className)}>{t.matchList.win}</span>
    case 'LOSS':
      return <span className={cn('text-sm font-semibold text-negative', className)}>{t.matchList.loss}</span>
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
// column. The row starts 14px in: 3px of it is the bar of the result. Under `md` it is the two lines of a row of the
// matches table on a phone (spec of the phone view, 4; `MatchesTable`): the map, and at the right the score over the
// word of the result; then, from under the map's name, one line that never wraps: K / D / A, ADR and the strongest
// highlights as the tags that fit (nothing stands at its right end, so three at most). The list reaches the edges of
// the screen there, and the row has 12px above and below and the page's gutter at its sides.
const DETAILED =
  'grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 pr-2 pl-3.5 max-md:gap-x-3 max-md:gap-y-2 max-md:px-(--page-gutter) max-md:py-3 md:grid-cols-[minmax(0,1fr)_7.5rem_auto_auto_16px] lg:grid-cols-[minmax(0,1fr)_7.5rem_11rem_auto_auto_16px]'
// The score at the end of a row, as the matches table writes it.
const SCORE = 'font-mono text-[19px] leading-none font-semibold tabular-nums'

/** The colour of the score of a detailed row on a phone (spec of the phone view, 4); from `md` the score is plain. */
const RESULT_TEXT: Record<MatchResult, string | undefined> = {
  WIN: 'max-md:text-positive',
  LOSS: 'max-md:text-negative',
  UNKNOWN: undefined,
}

// A row whose match the site cannot look up (the stored matches failed): the date, the result, the score and the arrow.
const PLAIN =
  'grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 pr-2 pl-3.5 sm:grid-cols-[9rem_minmax(0,1fr)_auto_auto]'

/**
 * A player's matches, one link per row to the match page; the whole row is the link, so its name carries the score,
 * which ends it. With `details` a row is drawn as a row of the matches table (`MatchesTable`): the map's emblem, its
 * name and under it the tag of where the match is from with the date, the figures and the strongest highlight. While the details are on
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
    <ul className={cn('border-t border-border', details && 'max-md:-mx-(--page-gutter)')}>
      {items.map((match) => {
        const date = formatDate(match.startedAt, locale)
        const scoreText = formatScore(match.score, match.result)
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
                <span className={SCORE}>{scoreText}</span>
                <ChevronRight aria-hidden="true" className="size-4 text-subtle" />
              </Link>
            </li>
          )
        }
        const known = details.state === 'ready'
        const stored = details.matches.get(match.matchId)
        // What a phone's second line has: what is not known is left out there (no dashes), and a row with none of it
        // has no second line.
        const kda = known && stored !== undefined && stored.kills !== null && stored.deaths !== null && stored.assists !== null
        const adr = known ? (stored?.adr ?? null) : null
        const tags = known && stored?.demoStatus === 'ANALYZED' && stored.highlights.some((kind) => kind.count > 0)
        return (
          <li key={match.matchId} className="border-b border-border">
            <Link
              to={`/matches/${encodeURIComponent(match.matchId)}`}
              className={cn(DETAILED, 'hover:bg-secondary', RESULT_ROW[match.result])}
            >
              <MatchMapCell
                matchId={match.matchId}
                mapName={stored?.mapName ?? null}
                name={known ? (mapLabel(stored?.mapName ?? null) ?? t.match.unknownMap) : null}
                date={date}
                startedAt={match.startedAt}
              />
              {/* A phone's second line. From `md` the box is not there (`contents`): K / D / A and the highlight are the
                  row's columns, and the phone's ADR and tags are not drawn. */}
              <span
                className={cn(
                  'contents max-md:col-span-2 max-md:row-start-2 max-md:flex max-md:min-w-0 max-md:items-center max-md:gap-3 max-md:pl-13',
                  !kda && adr === null && !tags && 'max-md:hidden',
                )}
              >
                <span
                  className={cn(
                    'hidden font-mono text-sm md:block',
                    (kda || adr !== null) && 'max-md:flex max-md:shrink-0 max-md:items-baseline max-md:gap-x-2',
                  )}
                >
                  {known && (
                    <span className={cn('max-md:text-[13px] max-md:font-medium max-md:whitespace-nowrap', !kda && 'max-md:hidden')}>
                      <Kda match={stored} />
                    </span>
                  )}
                  {/* The table's ADR, on a phone only: from `md` the row has no room for it. */}
                  {adr !== null && (
                    <span className="text-[11px] whitespace-nowrap text-subtle md:hidden">{`${t.stats.adr} ${adr.toFixed(1)}`}</span>
                  )}
                </span>
                <span className="hidden min-w-0 items-center lg:flex">{known && <TopHighlight match={stored} />}</span>
                {tags && stored && <PhoneHighlightTags highlights={stored.highlights} limit={3} />}
              </span>
              {/* On a phone the score is over the word of the result, at the right of the map, in the result's colour.
                  From `md` the box is not there (`contents`): the word and the score are the row's columns. */}
              <span className="contents max-md:col-start-2 max-md:row-start-1 max-md:flex max-md:flex-col-reverse max-md:items-end max-md:gap-1">
                <Result result={match.result} className="max-md:text-[11px]" />
                <span className={cn(SCORE, RESULT_TEXT[match.result])}>{scoreText}</span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 text-subtle max-md:hidden" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
