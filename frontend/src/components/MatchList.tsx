import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { WIN_BADGE_CLASS } from '@/lib/badgeStyles'
import { formatDate } from '@/lib/formatDate'
import type { MatchResult, MatchSummary } from '@/api/types'

/** `13 : 9`, or an en dash when FACEIT reported no score for one of the factions. */
function formatScore(score: Record<string, number>): string {
  const { faction1, faction2 } = score
  return typeof faction1 === 'number' && typeof faction2 === 'number' ? `${faction1} : ${faction2}` : '–'
}

function ResultBadge({ result }: { result: MatchResult }) {
  switch (result) {
    case 'WIN':
      return <Badge className={WIN_BADGE_CLASS}>WIN</Badge>
    case 'LOSS':
      return <Badge className="bg-red-600/15 text-red-700 dark:text-red-400">LOSS</Badge>
    default:
      return (
        <Badge variant="secondary">
          <span aria-hidden="true">—</span>
          <span className="sr-only">Result unknown</span>
        </Badge>
      )
  }
}

/** A player's matches, one link per row to the match page; the whole row is the link, so its name carries the score. */
export default function MatchList({ items }: { items: MatchSummary[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No matches yet</p>
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((match) => (
        <li key={match.matchId}>
          <Link
            to={`/matches/${encodeURIComponent(match.matchId)}`}
            className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2 outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <time dateTime={match.startedAt} className="text-sm text-muted-foreground">
              {formatDate(match.startedAt)}
            </time>
            <ResultBadge result={match.result} />
            <span className="font-mono text-sm tabular-nums">{formatScore(match.score)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
