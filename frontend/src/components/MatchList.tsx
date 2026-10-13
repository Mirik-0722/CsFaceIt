import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { useLocale, useT } from '@/i18n'
import { formatDate } from '@/lib/formatDate'
import { formatScore } from '@/lib/formatScore'
import { cn } from '@/lib/utils'
import type { MatchResult, MatchSummary } from '@/api/types'

// A row carries its result as the rows of the matches table do (the `result-row` utility: a bar at the left edge and a
// tint that fades out); a match without a known result has neither.
const RESULT_ROW: Record<MatchResult, string | undefined> = {
  WIN: 'result-row [--result:var(--positive)]',
  LOSS: 'result-row [--result:var(--negative)]',
  UNKNOWN: undefined,
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

/** A player's matches, one link per row to the match page; the whole row is the link, so its name carries the score. */
export default function MatchList({ items }: { items: MatchSummary[] }) {
  const t = useT()
  const locale = useLocale()
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.matchList.empty}</p>
  }
  return (
    <ul className="border-t border-border">
      {items.map((match) => (
        <li key={match.matchId} className="border-b border-border">
          <Link
            to={`/matches/${encodeURIComponent(match.matchId)}`}
            // The row starts 14px in: 3px of it is the bar of the result.
            className={cn(
              'grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 pr-2 pl-3.5 hover:bg-secondary sm:grid-cols-[9rem_minmax(0,1fr)_auto_auto]',
              RESULT_ROW[match.result],
            )}
          >
            <time dateTime={match.startedAt} className="font-mono text-xs text-subtle">
              {formatDate(match.startedAt, locale)}
            </time>
            <Result result={match.result} />
            <span className="font-mono text-[19px] leading-none font-semibold tabular-nums">
              {formatScore(match.score, match.result)}
            </span>
            <ChevronRight aria-hidden="true" className="size-4 text-subtle" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
