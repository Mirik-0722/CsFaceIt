import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import FaceitTag from '@/components/FaceitTag'
import MapEmblem from '@/components/MapEmblem'
import { Badge } from '@/components/ui/badge'
import { useLocale, useT } from '@/i18n'
import { formatMatchTime } from '@/lib/formatDate'
import { formatScore } from '@/lib/formatScore'
import { kindText, summarizeHighlights } from '@/lib/matchHighlights'
import { mapLabel } from '@/lib/mapTint'
import { cn } from '@/lib/utils'
import type { ClipCounts, PlayerMatchResponse } from '@/api/overview'
import type { DemoStatus, MatchResult } from '@/api/types'

// The columns of the header and of every row: the map with where the match is from and its date, the score, K / D / A,
// the highlights (the one that takes what is left), the clips and the arrow. The first one holds the emblem and, on one
// line, the FACEIT tag and the date; the number columns are as wide as their figures need, so that the highlights keep
// their room. The row starts 14px in: 3px of it is the bar of the result.
const COLUMNS = 'grid grid-cols-[220px_100px_104px_minmax(0,1fr)_160px_16px] items-center gap-4 pr-1 pl-3.5'

// A row carries its result (the `result-row` utility: a bar at the left edge and a tint that fades out); a match
// without a known result has neither. The word of the result stays in the row: the colour is never the only sign.
const RESULT_ROW: Record<MatchResult, string | undefined> = {
  WIN: 'result-row [--result:var(--positive)]',
  LOSS: 'result-row [--result:var(--negative)]',
  UNKNOWN: undefined,
}

/**
 * A figure of the stored line of the match. Where the backend has none it is a dash that screen readers do not read,
 * with the words "No data" for them, as in the maps table and the statistics tiles.
 */
function Figure({ value, digits = 0 }: { value: number | null; digits?: number }) {
  const t = useT()
  if (value === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t.statsCards.noData}</span>
      </>
    )
  }
  return value.toFixed(digits)
}

/** A demo that nothing has finished with yet: it is being fetched, read or analyzed. */
function isInProgress(status: DemoStatus | null): boolean {
  return status === 'QUEUED' || status === 'STORED' || status === 'PARSED'
}

/**
 * The strongest highlight of the match as a tag (only an ace is filled) and the others as a line of text. Without an
 * analyzed demo there is nothing to show: a match that has no demo, or whose demo failed, says that it has none, one
 * that is on its way gets a dash.
 */
function HighlightsCell({ match }: { match: PlayerMatchResponse }) {
  const t = useT()
  if (match.demoStatus === null || match.demoStatus === 'FAILED') {
    return <span className="font-mono text-xs text-subtle">{t.demo.none}</span>
  }
  const { top, rest } = summarizeHighlights(match.highlights, t)
  if (match.demoStatus !== 'ANALYZED' || !top) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        <span aria-hidden="true">—</span>
        {match.demoStatus === 'ANALYZED' && <span className="sr-only">{t.matches.highlights.none}</span>}
      </span>
    )
  }
  return (
    <>
      {/* Written as it is shown, as on the highlight cards: the tag leaves the case of `1v3 CLUTCH` alone. */}
      <Badge variant={top.type === 'ACE' ? 'default' : 'outline'} className="normal-case">
        {kindText(top, t)}
      </Badge>
      {rest && (
        // Two lines at most, so that the count of the kinds left out (`+3`) is not cut off with the rest of the text.
        <span title={rest} className="line-clamp-2 min-w-0 font-mono text-xs text-muted-foreground">
          {rest}
        </span>
      )}
    </>
  )
}

/**
 * The clips of the match: how many are in progress and how many are ready, or only how many are ready. `active` counts
 * every clip that is neither finished nor failed, the queued ones too, so there is no REC dot here: on this site the dot
 * says "being recorded now" (`StatusChip`), which this count does not. A demo that is being analyzed says so where the
 * clips would be. Nothing for a match without a clip. Failed clips are not counted here; the page of the match shows them.
 */
function ClipsCell({ clips, demoStatus }: { clips: ClipCounts; demoStatus: DemoStatus | null }) {
  const t = useT()
  if (clips.active > 0) {
    return (
      <span className="text-foreground">
        {t.matches.clips.active(clips.active)}
        {clips.done > 0 && ` · ${t.matches.clips.ready(clips.done)}`}
      </span>
    )
  }
  if (clips.done > 0) {
    return <span>{t.matches.clips.readyAlone(clips.done)}</span>
  }
  if (isInProgress(demoStatus)) {
    return (
      <span className="font-mono text-[11px] tracking-[0.06em] text-foreground uppercase">{t.matches.analyzing}</span>
    )
  }
  return null
}

/** One match: the whole row is the link to the match, so its name is everything the row says. */
function MatchRow({ match }: { match: PlayerMatchResponse }) {
  const t = useT()
  const locale = useLocale()
  const resultClass = match.result === 'WIN' ? 'text-positive' : match.result === 'LOSS' ? 'text-negative' : undefined
  const resultWord =
    match.result === 'WIN' ? t.matchList.win : match.result === 'LOSS' ? t.matchList.loss : t.matchList.unknown
  return (
    <li className="border-b border-border">
      <Link
        to={`/matches/${encodeURIComponent(match.matchId)}`}
        className={cn(COLUMNS, 'min-h-18 -outline-offset-2 hover:bg-secondary', RESULT_ROW[match.result])}
      >
        <span className="flex min-w-0 items-center gap-3">
          <MapEmblem mapName={match.mapName} size={44} />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-[15px] leading-5 font-semibold">{mapLabel(match.mapName) ?? t.match.unknownMap}</span>
            <span className="flex items-center gap-2">
              <FaceitTag />
              <time dateTime={match.startedAt} className="font-mono text-[11px] whitespace-nowrap text-subtle">
                {formatMatchTime(match.startedAt, locale)}
              </time>
            </span>
          </span>
        </span>
        <span className="flex flex-col">
          <span className={cn('font-mono text-[19px] leading-[1.3] font-semibold tabular-nums', resultClass)}>
            <span className="sr-only">{t.stats.score}</span> {formatScore(match.score, match.result)}
          </span>
          <span className="text-xs text-muted-foreground">{resultWord}</span>
        </span>
        <span className="flex flex-col">
          <span className="font-mono text-sm">
            <span className="sr-only">{`${t.stats.kills} / ${t.stats.deaths} / ${t.stats.assists}: `}</span>
            <Figure value={match.kills} /> / <Figure value={match.deaths} /> / <Figure value={match.assists} />
          </span>
          <span className="font-mono text-[11px] text-subtle">
            {t.stats.adr} <Figure value={match.adr} digits={1} />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <HighlightsCell match={match} />
        </span>
        <span className="flex items-center justify-end gap-2 text-[13px] text-muted-foreground">
          <ClipsCell clips={match.clips} demoStatus={match.demoStatus} />
        </span>
        <ChevronRight aria-hidden="true" className="size-4 text-subtle" />
      </Link>
    </li>
  )
}

/**
 * A player's matches as a table of rows (spec 3, screen 2): a header of mono labels and a link per match. It is as wide
 * as its six columns need, and scrolls in its box on a phone. The header only names the columns for the eye: each row's
 * name carries the words of what its figures are.
 */
export default function MatchesTable({ items }: { items: PlayerMatchResponse[] }) {
  const t = useT()
  return (
    // Positioned, so that the words only a screen reader hears (absolutely positioned, with the row they are in) are
    // clipped with the row, not left beyond the box where they would widen the page.
    <div className="relative overflow-x-auto">
      <div className="min-w-205">
        <div aria-hidden="true" className={cn(COLUMNS, 'label-mono h-9 border-b border-border')}>
          <span>{t.matches.columns.map}</span>
          <span>{t.matches.columns.score}</span>
          <span>{t.matches.columns.kda}</span>
          <span>{t.matches.columns.highlights}</span>
          <span className="text-right">{t.matches.columns.clips}</span>
          <span />
        </div>
        <ul aria-label={t.matches.title}>
          {items.map((match) => (
            <MatchRow key={match.matchId} match={match} />
          ))}
        </ul>
      </div>
    </div>
  )
}
