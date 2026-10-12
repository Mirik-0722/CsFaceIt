import type { UseQueryResult } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useDemo, useMatch, useMatchClips, useMatchHighlights, useMatchStats } from '@/api/queries'
import ClipButton from '@/components/ClipButton'
import ClipList from '@/components/ClipList'
import ClipOrderDialog, { type ClipOrder } from '@/components/ClipOrderDialog'
import DemoPanel from '@/components/DemoPanel'
import HighlightList from '@/components/HighlightList'
import MapTile from '@/components/MapTile'
import MatchScore from '@/components/MatchScore'
import RecDot from '@/components/RecDot'
import RecorderBanner from '@/components/RecorderBanner'
import StatsTable from '@/components/StatsTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale, useT } from '@/i18n'
import { clipFor, compilationFor } from '@/lib/clips'
import { errorMessage } from '@/lib/errorMessage'
import { formatDate } from '@/lib/formatDate'
import { hasLost } from '@/lib/hasLost'
import { highlightGroup, type HighlightGroup } from '@/lib/highlightLabels'
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

type HighlightFilter = 'all' | HighlightGroup

const HIGHLIGHT_FILTERS: HighlightFilter[] = ['all', 'multi', 'clutch', 'special']

/**
 * The highlights of the match with a filter by kind above them. The filter works on what is already loaded; each
 * button carries the number of highlights it would show. Every card ends with what can be done about the clip of its
 * highlight: any highlight can be recorded, of whatever kind. A failure stays inside the section.
 */
function MatchHighlights({ matchId, onOrder }: { matchId: string; onOrder: (order: ClipOrder) => void }) {
  const t = useT()
  const highlights = useMatchHighlights(matchId)
  const clips = useMatchClips(matchId)
  const [filter, setFilter] = useState<HighlightFilter>('all')
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
                <ClipButton
                  clip={clipFor(highlight, matchClips)}
                  onOrder={() => onOrder({ kind: 'highlight', highlight })}
                />
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
    </section>
  )
}

interface CompilationProps {
  matchId: string
  mapName: string | null
  /** The teams of the scoreboard, once the stats have arrived. */
  teams: TeamStatsResponse[] | undefined
  onOrder: (order: ClipOrder) => void
}

/**
 * One video of every kill of a player in the match (spec 4, the compilation panel). It is cut from the kills of the
 * demo, so the panel is there once the demo has been parsed. The players to choose from are those of the scoreboard
 * and, after them, players the highlights name that the scoreboard does not (a player the backend knows only from
 * the demo). Beside the chosen player stands the state of that player's compilation, as on a highlight card.
 */
function Compilation({ matchId, mapName, teams, onOrder }: CompilationProps) {
  const t = useT()
  const playerFieldId = useId()
  const demo = useDemo(matchId)
  const highlights = useMatchHighlights(matchId)
  const clips = useMatchClips(matchId)
  const [chosenId, setChosenId] = useState('')
  const status = demo.data?.status
  const players = [...(teams ?? []).flatMap((team) => team.players), ...(highlights.data ?? [])]
    .map(({ playerId, nickname }) => ({ playerId, nickname }))
    .filter((player, index, all) => all.findIndex((other) => other.playerId === player.playerId) === index)
  const matchClips = clips.data
  if ((status !== 'PARSED' && status !== 'ANALYZED') || players.length === 0 || !matchClips) {
    return null
  }
  const chosen = players.find((player) => player.playerId === chosenId)
  const record = t.clip.compilationPanel.record
  return (
    <section className="flex flex-wrap items-end gap-x-8 gap-y-4 border border-border px-6 py-5.5">
      <div className="flex min-w-0 flex-[999_1_24rem] flex-col gap-1">
        <h2 className="text-[17px] leading-[1.4] font-semibold">{t.clip.compilation}</h2>
        <p className="text-sm text-muted-foreground">{t.clip.compilationPanel.text}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={playerFieldId} className="label-mono">
            {t.clip.compilationPanel.playerLabel}
          </label>
          <select
            id={playerFieldId}
            value={chosenId}
            onChange={(event) => setChosenId(event.target.value)}
            className="h-11 max-w-full min-w-48 rounded-lg border border-border bg-card px-3 text-base text-foreground"
          >
            <option value="">{t.clip.compilationPanel.choosePlayer}</option>
            {players.map((player) => (
              <option key={player.playerId} value={player.playerId}>
                {player.nickname}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-h-11 min-w-0 items-center gap-3">
          {chosen ? (
            <ClipButton
              clip={compilationFor(chosen.playerId, matchClips)}
              label={record}
              variant="outline"
              onOrder={() => onOrder({ kind: 'compilation', matchId, mapName, ...chosen })}
            />
          ) : (
            // Nothing to record until a player is chosen: the button is there to say what the panel is for.
            <Button type="button" variant="outline" disabled>
              <RecDot />
              {record}
            </Button>
          )}
        </div>
      </div>
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
  // What is being ordered, a highlight's clip or a compilation; the one dialog of the page is open while there is one.
  const [order, setOrder] = useState<ClipOrder | null>(null)
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
      {match.data && <MatchHighlights matchId={matchId} onOrder={setOrder} />}
      {match.data && (
        <Compilation matchId={matchId} mapName={match.data.mapName} teams={stats.data?.teams} onOrder={setOrder} />
      )}
      {match.data && <MatchClips matchId={matchId} />}
      {!matchFailed && (
        // The tables follow the header, so a match that then turns out to be missing never flashes them.
        <div aria-live="polite" className="flex flex-col gap-6">
          {match.data ? <MatchStats stats={stats} /> : <StatsSkeleton />}
        </div>
      )}
      <ClipOrderDialog order={order} onClose={() => setOrder(null)} />
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
