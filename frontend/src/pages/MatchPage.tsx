import type { UseQueryResult } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useMatch, useMatchStats } from '@/api/queries'
import MapTile from '@/components/MapTile'
import MatchScore from '@/components/MatchScore'
import StatsTable from '@/components/StatsTable'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale, useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'
import { formatDate } from '@/lib/formatDate'
import { hasLost } from '@/lib/hasLost'
import { mapLabel } from '@/lib/mapTint'
import type { ApiError } from '@/api/client'
import type { MatchResponse, MatchStatsResponse, TeamStatsResponse } from '@/api/types'

/**
 * The map, the start date and the status of a match, each left out while FACEIT has not published it, and the score
 * of the two teams once the stats have arrived.
 */
function MatchHeader({ match, teams }: { match: MatchResponse; teams: TeamStatsResponse[] | undefined }) {
  const t = useT()
  const locale = useLocale()
  return (
    <Card>
      <CardContent className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <MapTile mapName={match.mapName} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle className="truncate text-[26px] leading-[1.2] tracking-[-0.02em]">
              {mapLabel(match.mapName) ?? t.match.unknownMap}
            </CardTitle>
            {(match.mapName || match.startedAt || match.status) && (
              // The raw map name, the date and the status are separate elements: each is one fact of its own. The
              // status is upper case by CSS, so its look does not depend on the case FACEIT sends.
              <div className="flex flex-wrap gap-x-3 font-mono text-xs text-subtle">
                {match.mapName && <span>{match.mapName}</span>}
                {match.startedAt && <time dateTime={match.startedAt}>{formatDate(match.startedAt, locale)}</time>}
                {match.status && (
                  <span data-slot="match-status" className="uppercase">
                    {match.status}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {teams && <MatchScore teams={teams} />}
      </CardContent>
    </Card>
  )
}

/** Two outlined boxes where the scoreboards will be, with the loading text as a label above them (spec 7). */
function StatsSkeleton() {
  const t = useT()
  return (
    <div className="flex flex-col gap-2">
      <p className="label-mono">{t.match.loadingStats}</p>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

/** One table per team, or the reason there is none. Stats that are already loaded win over a failed refetch. */
function MatchStats({ stats }: { stats: UseQueryResult<MatchStatsResponse, ApiError> }) {
  const t = useT()
  if (stats.data) {
    const teams = stats.data.teams
    if (teams.length === 0) {
      return <p className="text-sm text-muted-foreground">{t.match.statsUnavailable}</p>
    }
    return teams.map((team) => <StatsTable key={team.teamId} team={team} lost={hasLost(team, teams)} />)
  }
  if (stats.isError) {
    // The backend answers 404 for the stats of a match that is still being played; the match itself exists.
    return (
      <p className="text-sm text-muted-foreground">
        {stats.error.code === 'MATCH_NOT_FOUND' ? t.match.statsUnavailable : errorMessage(stats.error, t)}
      </p>
    )
  }
  return <StatsSkeleton />
}

function MatchDetails({ matchId }: { matchId: string }) {
  const t = useT()
  const match = useMatch(matchId)
  const stats = useMatchStats(matchId)
  // A match that cannot be shown has no stats to show either: its error is the one message on the page.
  const matchFailed = match.isError && !match.data

  return (
    // 24px between the header panel and the first scoreboard, as between the scoreboards (spec 2.3: 24–36px between
    // sections).
    <div className="flex flex-col gap-6">
      <div aria-live="polite">
        {match.isPending && (
          <>
            <p className="label-mono mb-2">{t.match.loading}</p>
            <Skeleton className="h-24 w-full" />
          </>
        )}
        {matchFailed && <p className="text-sm text-destructive">{errorMessage(match.error, t)}</p>}
        {match.data && <MatchHeader match={match.data} teams={stats.data?.teams} />}
      </div>
      {!matchFailed && (
        // The tables follow the header, so a match that then turns out to be missing never flashes them.
        <div aria-live="polite" className="flex flex-col gap-6">
          {match.data ? <MatchStats stats={stats} /> : <StatsSkeleton />}
        </div>
      )}
    </div>
  )
}

export default function MatchPage() {
  const t = useT()
  const { matchId } = useParams()
  return (
    // The map name in the header is the page's big title, so the h1 is a small label above it.
    <main className="container-page flex flex-col gap-4 pt-9 pb-18">
      <h1 className="label-mono">{t.match.title}</h1>
      {matchId ? (
        <MatchDetails matchId={matchId} />
      ) : (
        <p className="text-sm text-destructive">{t.errors.matchNotFound}</p>
      )}
    </main>
  )
}
