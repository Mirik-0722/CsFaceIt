import type { UseQueryResult } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useMatch, useMatchStats } from '@/api/queries'
import StatsTable from '@/components/StatsTable'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage, MATCH_NOT_FOUND_MESSAGE } from '@/lib/errorMessage'
import { formatDate } from '@/lib/formatDate'
import type { ApiError } from '@/api/client'
import type { MatchResponse, MatchStatsResponse } from '@/api/types'

const STATS_UNAVAILABLE_MESSAGE = 'Stats are not available for this match yet.'

/** The map, the start date and the status of a match; each is left out while FACEIT has not published it. */
function MatchHeader({ match }: { match: MatchResponse }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="truncate text-lg">{match.mapName ?? 'Unknown map'}</CardTitle>
          {match.startedAt && (
            <CardDescription>
              <time dateTime={match.startedAt}>{formatDate(match.startedAt)}</time>
            </CardDescription>
          )}
        </div>
        {match.status && <Badge variant="secondary">{match.status}</Badge>}
      </CardContent>
    </Card>
  )
}

function StatsSkeleton() {
  return (
    <>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
      <span className="sr-only">Loading stats…</span>
    </>
  )
}

/** One table per team, or the reason there is none. Stats that are already loaded win over a failed refetch. */
function MatchStats({ stats }: { stats: UseQueryResult<MatchStatsResponse, ApiError> }) {
  if (stats.data) {
    return stats.data.teams.length === 0 ? (
      <p className="text-sm text-muted-foreground">{STATS_UNAVAILABLE_MESSAGE}</p>
    ) : (
      stats.data.teams.map((team) => <StatsTable key={team.teamId} team={team} />)
    )
  }
  if (stats.isError) {
    // The backend answers 404 for the stats of a match that is still being played; the match itself exists.
    return (
      <p className="text-sm text-muted-foreground">
        {stats.error.code === 'MATCH_NOT_FOUND' ? STATS_UNAVAILABLE_MESSAGE : errorMessage(stats.error)}
      </p>
    )
  }
  return <StatsSkeleton />
}

function MatchDetails({ matchId }: { matchId: string }) {
  const match = useMatch(matchId)
  const stats = useMatchStats(matchId)
  // A match that cannot be shown has no stats to show either: its error is the one message on the page.
  const matchFailed = match.isError && !match.data

  return (
    <>
      <div aria-live="polite">
        {match.isPending && (
          <>
            <Skeleton className="h-16 w-full" />
            <span className="sr-only">Loading match…</span>
          </>
        )}
        {matchFailed && <p className="text-sm text-destructive">{errorMessage(match.error)}</p>}
        {match.data && <MatchHeader match={match.data} />}
      </div>
      {!matchFailed && (
        // The tables follow the header, so a match that then turns out to be missing never flashes them.
        <div aria-live="polite" className="flex flex-col gap-6">
          {match.data ? <MatchStats stats={stats} /> : <StatsSkeleton />}
        </div>
      )}
    </>
  )
}

export default function MatchPage() {
  const { matchId } = useParams()
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Match</h1>
      {matchId ? (
        <MatchDetails matchId={matchId} />
      ) : (
        <p className="text-sm text-destructive">{MATCH_NOT_FOUND_MESSAGE}</p>
      )}
    </main>
  )
}
