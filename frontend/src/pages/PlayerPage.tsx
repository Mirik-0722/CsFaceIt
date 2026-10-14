import { useId } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { usePlayerMatches, usePlayerOverview } from '@/api/overview'
import { usePlayer, usePlayerClips, usePlayerHighlights, usePlayerHistory, usePlayerStats } from '@/api/queries'
import ClipList from '@/components/ClipList'
import FormStrip, { FormStripPlaceholder } from '@/components/FormStrip'
import HighlightBreakdown from '@/components/HighlightBreakdown'
import HighlightList from '@/components/HighlightList'
import MapsTable from '@/components/MapsTable'
import MatchList, { type MatchDetails } from '@/components/MatchList'
import PlayerHeader from '@/components/PlayerHeader'
import StatsCards from '@/components/StatsCards'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'
import { isMatchmakingMatch, isSteamPlayer } from '@/lib/matchSource'
import { mostPlayedMap, mostPlayedScenery } from '@/lib/mostPlayedScenery'
import { cn } from '@/lib/utils'
import type { MatchSummary } from '@/api/types'

/**
 * How many of the newest highlights the profile shows; all of them are on the highlights page. Six fill one, two or
 * three columns of the grid without leaving a card alone on the last row.
 */
const LATEST_HIGHLIGHTS = 6

/**
 * The player's figures over the stored matches. The board draws the cards without a heading above them, so the heading
 * that names the section is for screen readers. A failure stays inside the section: the rest of the page stands.
 */
function PlayerStats({ playerId }: { playerId: string }) {
  const t = useT()
  const titleId = useId()
  const stats = usePlayerStats(playerId)
  return (
    // 36px under the header, as the board's page rhythm is (the page's own gap is 16px).
    <section aria-labelledby={titleId} className="flex flex-col gap-4 pt-5">
      <h2 id={titleId} className="sr-only">
        {t.statsCards.title}
      </h2>
      <div aria-live="polite" className="flex flex-col gap-2">
        {stats.isPending && (
          <>
            <p className="label-mono">{t.statsCards.loading}</p>
            {/* Eight cards as tall as the real ones (124px) in their grid, so that nothing jumps when they arrive. */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-31" />
              ))}
            </div>
          </>
        )}
        {stats.data && <StatsCards stats={stats.data} />}
        {stats.isError && !stats.data && <p className="text-sm text-destructive">{errorMessage(stats.error, t)}</p>}
      </div>
    </section>
  )
}

/**
 * The player's stored matches by map beside the player's highlights by kind (spec 4, screen 8): two columns where both
 * fit, one under the other below that. Each is there only while it has a row to show; while the answer is awaited both
 * are, as skeletons, and a failure stays in the first of them.
 */
function PlayerOverview({ playerId }: { playerId: string }) {
  const t = useT()
  const mapsTitleId = useId()
  const typesTitleId = useId()
  const overview = usePlayerOverview(playerId)
  const maps = overview.data?.maps ?? []
  const kinds = overview.data?.highlights ?? []
  const failed = overview.isError && !overview.data
  if (overview.data && maps.length === 0 && kinds.length === 0) {
    return null
  }
  return (
    <div className="flex flex-wrap items-start gap-x-12 gap-y-7 pt-5">
      {(overview.isPending || failed || maps.length > 0) && (
        // The basis is the least the table needs (`min-w-160`), so that the second column goes under it where the table
        // would have to scroll beside it.
        <section className="flex min-w-0 flex-[999_1_640px] flex-col gap-3.5">
          <h2 id={mapsTitleId} className="heading-section">
            {t.matches.maps.title}
          </h2>
          <div aria-live="polite" className="flex flex-col gap-2">
            {overview.isPending && (
              <>
                <p className="label-mono">{t.matches.maps.loading}</p>
                <Skeleton className="h-64 w-full" />
              </>
            )}
            {maps.length > 0 && <MapsTable maps={maps} labelledBy={mapsTitleId} />}
            {failed && <p className="text-sm text-destructive">{errorMessage(overview.error, t)}</p>}
          </div>
        </section>
      )}
      {(overview.isPending || kinds.length > 0) && (
        <section className="flex min-w-0 flex-[1_1_340px] flex-col gap-3.5">
          <h2 id={typesTitleId} className="heading-section">
            {t.matches.types.title}
          </h2>
          <div aria-live="polite" className="flex flex-col gap-2">
            {overview.isPending && (
              <>
                <p className="label-mono">{t.matches.types.loading}</p>
                <Skeleton className="h-64 w-full" />
              </>
            )}
            {kinds.length > 0 && <HighlightBreakdown highlights={kinds} labelledBy={typesTitleId} />}
          </div>
        </section>
      )}
    </div>
  )
}

/** The newest highlights of the player, with a link to all of them when there is at least one. */
function LatestHighlights({ playerId }: { playerId: string }) {
  const t = useT()
  const highlights = usePlayerHighlights(playerId, null, LATEST_HIGHLIGHTS)
  const items = highlights.data?.pages[0]?.items
  return (
    <section className="flex flex-col gap-4 pt-3">
      <h2 className="heading-section">{t.highlight.title}</h2>
      <div aria-live="polite" className="flex flex-col gap-2">
        {highlights.isPending && (
          <>
            <p className="label-mono">{t.highlight.loading}</p>
            <Skeleton className="h-40 w-full" />
          </>
        )}
        {items && <HighlightList items={items} showMatch />}
        {highlights.isError && !items && (
          <p className="text-sm text-destructive">{errorMessage(highlights.error, t)}</p>
        )}
      </div>
      {items && items.length > 0 && (
        <Link
          to={`/players/${encodeURIComponent(playerId)}/highlights`}
          className={cn(buttonVariants({ variant: 'outline' }), 'self-center')}
        >
          {t.highlight.all}
        </Link>
      )}
    </section>
  )
}

/**
 * The player's clips, in whatever state, newest first, a page at a time. Most players have none, so the section is
 * there only once it has a clip to show, or a failure to report (which stays inside it).
 */
function PlayerClips({ playerId }: { playerId: string }) {
  const t = useT()
  const clips = usePlayerClips(playerId)
  // Offset paging can return the same clip on two pages (each page is cached on its own), so keep the first.
  const items = clips.data?.pages
    .flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
  if (!clips.isError && (!items || items.length === 0)) {
    return null
  }
  return (
    <section className="flex flex-col gap-4 pt-3">
      <h2 className="heading-section">{t.clip.listTitle}</h2>
      <div aria-live="polite" className="flex flex-col gap-2">
        {items && items.length > 0 && <ClipList items={items} />}
        {clips.isError && <p className="text-sm text-destructive">{errorMessage(clips.error, t)}</p>}
      </div>
      {clips.hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={clips.isFetchingNextPage}
          onClick={() => clips.fetchNextPage()}
        >
          {t.player.loadMore}
        </Button>
      )}
    </section>
  )
}

/**
 * The FACEIT history with the person's matchmaking matches merged in by start, both newest first: a FACEIT line keeps
 * its place, and a matchmaking match goes before the first line that started earlier (as the backend merges a page).
 */
function withMatchmaking(history: MatchSummary[], matchmaking: MatchSummary[]): MatchSummary[] {
  const merged: MatchSummary[] = []
  let next = 0
  for (const line of history) {
    while (next < matchmaking.length && Date.parse(matchmaking[next].startedAt) > Date.parse(line.startedAt)) {
      merged.push(matchmaking[next++])
    }
    merged.push(line)
  }
  return [...merged, ...matchmaking.slice(next)]
}

/** Keeps the first of the rows that share a match: offset paging can return the same match on two pages. */
function firstOfEach<Row extends { matchId: string }>(rows: Row[]): Row[] {
  return rows.filter((item, index, all) => all.findIndex((other) => other.matchId === item.matchId) === index)
}

function PlayerProfile({ playerId }: { playerId: string }) {
  const t = useT()
  // A player known only from demos (`steam:<SteamID>`) has no FACEIT history: the list of matches is the stored one.
  const steam = isSteamPlayer(playerId)
  const player = usePlayer(playerId)
  const history = usePlayerHistory(playerId, undefined, !steam)
  // The history comes from FACEIT and knows no map: the map, the figures and the highlights of each row come from the
  // player's stored matches, the request of the page of matches (one cache), looked up by `matchId`. The stored matches
  // also hold the person's matchmaking matches, which FACEIT's history does not.
  const stored = usePlayerMatches(playerId)
  // The overview is asked for by the maps table below as well: one request, shared. Its most played map is the header's
  // scenery once the answer is there; until then, and for a player without one, the header is plain.
  const overview = usePlayerOverview(playerId)
  const scenery = overview.data ? mostPlayedScenery(overview.data.maps) : null
  const mainMap = overview.data ? mostPlayedMap(overview.data.maps) : null
  const storedItems = stored.data ? firstOfEach(stored.data.pages.flatMap((page) => page.items)) : undefined
  // The list of the page: for a `steam:` player the stored matches; for a FACEIT player the history, with the
  // matchmaking matches of the stored pages merged in. Each stored page covers the stretch of time of the history's page
  // of the same number, so while the history has more, only as many stored pages as history pages are merged (the page
  // of matches shares the cache and may have loaded more): a row never lands beyond the history that is loaded. Once
  // the history has ended, the older matchmaking matches still come a page at a time from the stored list.
  const list = steam ? stored : history
  const historyPages = history.data?.pages.length ?? 0
  const storedPages = stored.data?.pages.length ?? 0
  const hasMore = steam ? stored.hasNextPage : history.hasNextPage || stored.hasNextPage
  const loadingMore = history.isFetchingNextPage || stored.isFetchingNextPage
  // A FACEIT player's list is drawn once both have answered (or the stored list failed: then without matchmaking
  // matches), so that the matchmaking rows do not push the history down when they arrive.
  const waiting = steam ? stored.isPending : history.isPending || (stored.isPending && !history.isError)
  const historyItems = history.data ? firstOfEach(history.data.pages.flatMap((page) => page.items)) : undefined
  const merged = (stored.data?.pages ?? [])
    .slice(0, history.hasNextPage ? historyPages : undefined)
    .flatMap((page) => page.items)
  const matches: MatchSummary[] | undefined = waiting
    ? undefined
    : steam
      ? storedItems
      : historyItems &&
        withMatchmaking(
          historyItems,
          firstOfEach(merged).filter(
            (match) =>
              isMatchmakingMatch(match.matchId) && !historyItems.some((line) => line.matchId === match.matchId),
          ),
        )
  const details: MatchDetails | undefined = stored.data
    ? {
        state: 'ready',
        matches: new Map(stored.data.pages.flatMap((page) => page.items).map((match) => [match.matchId, match])),
      }
    : stored.isPending
      ? { state: 'pending', matches: new Map() }
      : undefined
  // A player that cannot be shown has no history to show either: its error is the one message on the page.
  const playerFailed = player.isError && !player.data
  // The page of matches lists the same history with what the site knows about each match: no row, no link.
  const hasMatches = (matches?.length ?? 0) > 0

  // A SteamID that turned out to be a FACEIT player's (who signed in with it): that player's page is the one.
  if (steam && player.data && player.data.playerId !== playerId) {
    return <Navigate replace to={`/players/${encodeURIComponent(player.data.playerId)}`} />
  }

  return (
    <>
      <div aria-live="polite">
        {player.isPending && (
          // Made of the head's own parts, so that what follows does not move when the player arrives (see
          // `ProfileHeader`): the first row (the label and the skeleton) is as tall as the head's, 114px, and 122px under
          // `sm`, where the mono line wraps beside the ring;
          // under `md` the strip's place is a row of its own below it, as in the head, whatever the player is; from `md`
          // it is beside the row, as the strip is where there is room.
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5 max-md:flex-col max-md:items-start">
            <div className="flex h-30.5 min-w-0 flex-col max-md:w-full sm:h-28.5 md:flex-1">
              <p className="label-mono mb-2">{t.player.loading}</p>
              <Skeleton className="min-h-0 w-full flex-1" />
            </div>
            <FormStripPlaceholder />
          </div>
        )}
        {playerFailed && <p className="text-sm text-destructive">{errorMessage(player.error, t)}</p>}
        {player.data && (
          <PlayerHeader
            player={player.data}
            size="lg"
            // Its place is kept while the history is awaited, as in the loading block above: where the strip takes a row of
            // its own, the rest of the page would move down by that row when the history arrives.
            aside={waiting ? <FormStripPlaceholder /> : <FormStrip matches={matches ?? []} />}
            scenery={scenery}
            mainMap={mainMap}
          />
        )}
      </div>
      {!playerFailed && <PlayerStats playerId={playerId} />}
      {!playerFailed && <PlayerOverview playerId={playerId} />}
      {!playerFailed && <LatestHighlights playerId={playerId} />}
      {!playerFailed && <PlayerClips playerId={playerId} />}
      {!playerFailed && (
        <section className="flex flex-col gap-4 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <h2 className="heading-section">{t.player.history}</h2>
            {hasMatches && (
              <Link
                to={`/players/${encodeURIComponent(playerId)}/matches`}
                aria-label={t.matches.allLabel}
                className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 hover:text-primary"
              >
                {t.matches.all}
              </Link>
            )}
          </div>
          <div aria-live="polite" className="flex flex-col gap-2">
            {waiting && (
              <>
                <p className="label-mono">{t.player.loadingMatches}</p>
                {/* 12px between the rows of the placeholder, 8px under its label as under every loading label. */}
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              </>
            )}
            {matches && <MatchList items={matches} details={details} />}
            {list.isError && <p className="text-sm text-destructive">{errorMessage(list.error, t)}</p>}
          </div>
          {hasMore && (
            <Button
              variant="outline"
              className="self-center"
              disabled={loadingMore}
              onClick={() => {
                // The next page of both: the rows it brings look their maps up in the stored matches' next page. The
                // stored list is not taken ahead of the history (the page of matches may have loaded it further; one that
                // fell behind after a failure catches up a page at a time); once the history has ended it goes on alone.
                // A `steam:` player's list is the stored matches themselves.
                const historyGoesOn = !steam && history.hasNextPage
                if (historyGoesOn) {
                  void history.fetchNextPage()
                }
                if (
                  stored.hasNextPage &&
                  !stored.isFetchingNextPage &&
                  (!historyGoesOn || storedPages <= historyPages)
                ) {
                  void stored.fetchNextPage()
                }
              }}
            >
              {t.player.loadMore}
            </Button>
          )}
        </section>
      )}
    </>
  )
}

export default function PlayerPage() {
  const t = useT()
  const { playerId } = useParams()
  return (
    <main className="container-page flex flex-col gap-4 pt-9 pb-18">
      {/* The board has no label above the name: the nickname in the header is the page's big title, and this h1 only
          names the page for those who hear it. */}
      <h1 className="sr-only">{t.player.title}</h1>
      {playerId ? (
        <PlayerProfile playerId={playerId} />
      ) : (
        <p className="text-sm text-destructive">{t.errors.playerNotFound}</p>
      )}
    </main>
  )
}
