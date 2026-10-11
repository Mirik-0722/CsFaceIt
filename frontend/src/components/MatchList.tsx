import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { useLocale, useT } from '@/i18n'
import { formatDate } from '@/lib/formatDate'
import type { MatchResult, MatchSummary } from '@/api/types'

/**
 * `13 : 9` with the player's own rounds first, or an en dash when FACEIT reported no score for one of the factions.
 * FACEIT orders the score by faction, not by player; the result tells the sides apart, because the winner has more
 * rounds. Without a known result the order stays as FACEIT sent it.
 */
function formatScore(score: Record<string, number>, result: MatchResult): string {
  const { faction1, faction2 } = score
  if (typeof faction1 !== 'number' || typeof faction2 !== 'number') {
    return '–'
  }
  const higher = Math.max(faction1, faction2)
  const lower = Math.min(faction1, faction2)
  switch (result) {
    case 'WIN':
      return `${higher} : ${lower}`
    case 'LOSS':
      return `${lower} : ${higher}`
    default:
      return `${faction1} : ${faction2}`
  }
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
            className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 px-2 hover:bg-secondary sm:grid-cols-[9rem_minmax(0,1fr)_auto_auto]"
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
