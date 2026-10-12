import type { UseQueryResult } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMatch, useMatchClips, useMatchHighlights, useMatchStats } from '@/api/queries'
import ClipButton from '@/components/ClipButton'
import ClipList from '@/components/ClipList'
import ClipOrderDialog from '@/components/ClipOrderDialog'
import DemoPanel from '@/components/DemoPanel'
import HighlightList from '@/components/HighlightList'
import MapTile from '@/components/MapTile'
import MatchScore from '@/components/MatchScore'
import RecorderBanner from '@/components/RecorderBanner'
import StatsTable from '@/components/StatsTable'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale, useT } from '@/i18n'
import { clipFor } from '@/lib/clips'
import { errorMessage } from '@/lib/errorMessage'
import { formatDate } from '@/lib/formatDate'
import { hasLost } from '@/lib/hasLost'
import { highlightGroup, type HighlightGroup } from '@/lib/highlightLabels'
import { mapLabel } from '@/lib/mapTint'
import type { ApiError } from '@/api/client'
import type { HighlightResponse, MatchResponse, MatchStatsResponse, TeamStatsResponse } from '@/api/types'

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

type HighlightFilter = 'all' | HighlightGroup

const HIGHLIGHT_FILTERS: HighlightFilter[] = ['all', 'multi', 'clutch', 'special']

/**
 * The highlights of the match with a filter by kind above them. The filter works on what is already loaded; each
 * button carries the number of highlights it would show. Every card ends with what can be done about the clip of its
 * highlight: any highlight can be recorded, of whatever kind. A failure stays inside the section.
 */
function MatchHighlights({ matchId }: { matchId: string }) {
  const t = useT()
  const highlights = useMatchHighlights(matchId)
  const clips = useMatchClips(matchId)
  const [filter, setFilter] = useState<HighlightFilter>('all')
  // The highlight whose clip is being ordered; the dialog is open while there is one.
  const [ordering, setOrdering] = useState<HighlightResponse | null>(null)
  const items = highlights.data
  const matchClips = clips.data
  const labels: Record<HighlightFilter, string> = {
    all: t.highlight.groupAll,
    multi: t.highlight.groupMulti,
    clutch: t.highlight.groupClutch,
    special: t.highlight.groupSpecial,
  }
  const matching = (kind: HighlightFilter) =>
    (items ?? []).filter((highlight) => kind === 'all' || highlightGroup(highlight.type) === kind)
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h2 className="heading-section">{t.highlight.title}</h2>
        {items && items.length > 0 && (
          // Toggle buttons that look like tabs (spec 3): 44px tall, a 2px light line under the chosen one.
          <div role="group" aria-label={t.highlight.filterLabel} className="-mx-3 flex flex-wrap">
            {HIGHLIGHT_FILTERS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={filter === kind}
                onClick={() => setFilter(kind)}
                className="inline-flex min-h-11 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-semibold text-muted-foreground hover:text-foreground aria-pressed:border-foreground aria-pressed:text-foreground"
              >
                {labels[kind]}
                <span className="font-mono text-xs font-normal text-subtle tabular-nums">{matching(kind).length}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {highlights.isPending && (
          <>
            <p className="label-mono">{t.highlight.loading}</p>
            <Skeleton className="h-40 w-full" />
          </>
        )}
        {items && items.length > 0 && <RecorderBanner />}
        {items && (
          <HighlightList
            items={matching(filter)}
            showMatch={false}
            // Until the clips of the match are known, a card cannot say whether its highlight has one: no row yet.
            action={
              matchClips &&
              ((highlight) => (
                <ClipButton clip={clipFor(highlight, matchClips)} onOrder={() => setOrdering(highlight)} />
              ))
            }
          />
        )}
        {highlights.isError && !items && (
          <p className="text-sm text-destructive">{errorMessage(highlights.error, t)}</p>
        )}
        {items && items.length > 0 && clips.isError && !matchClips && (
          <p className="text-sm text-destructive">{errorMessage(clips.error, t)}</p>
        )}
      </div>
      <ClipOrderDialog highlight={ordering} open={ordering !== null} onClose={() => setOrdering(null)} />
    </section>
  )
}

/**
 * The clips of the match, in whatever state, newest first. A match without clips has no such section: the way to the
 * first clip is the button on a highlight.
 */
function MatchClips({ matchId }: { matchId: string }) {
  const t = useT()
  const clips = useMatchClips(matchId)
  if (!clips.data || clips.data.length === 0) {
    return null
  }
  return (
    <section className="flex flex-col gap-4">
      <h2 className="heading-section">{t.clip.listTitle}</h2>
      <ClipList items={clips.data} />
    </section>
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
      {/* The demo and what was found in it belong to a match that exists: they wait for the header. */}
      {match.data && <DemoPanel matchId={matchId} />}
      {match.data && <MatchHighlights matchId={matchId} />}
      {match.data && <MatchClips matchId={matchId} />}
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
        // Keyed by the match: what the panel, the filter and the clip order remember (a chosen file, a typed key, a
        // message, the chosen kind, an open dialog) must not follow the visitor to another match when only the id in
        // the URL changes.
        <MatchDetails key={matchId} matchId={matchId} />
      ) : (
        <p className="text-sm text-destructive">{t.errors.matchNotFound}</p>
      )}
    </main>
  )
}
