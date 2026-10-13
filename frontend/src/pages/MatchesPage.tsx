import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CLIPS_POLL_MS, type PlayerMatchResponse, usePlayerMatches } from '@/api/overview'
import { usePlayer } from '@/api/queries'
import MatchesTable from '@/components/MatchesTable'
import RecorderCard from '@/components/RecorderCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'

/**
 * How old the rows may get while the refreshes keep failing before the page says so: three of the page's own polling
 * intervals, so that one or two failed ticks stay silent.
 */
const STALE_AFTER_MS = 3 * CLIPS_POLL_MS

type Filter = 'all' | 'analyzed' | 'needsDemo'

const FILTERS: Filter[] = ['all', 'analyzed', 'needsDemo']

/**
 * Whether a match belongs under a filter: "analyzed" are those with a finished analysis, "needs a demo" those the
 * backend has no demo of, or whose demo failed. A demo that is on its way is neither, so it is only in "all".
 */
function isIn(filter: Filter, match: PlayerMatchResponse): boolean {
  switch (filter) {
    case 'analyzed':
      return match.demoStatus === 'ANALYZED'
    case 'needsDemo':
      return match.demoStatus === null || match.demoStatus === 'FAILED'
    default:
      return true
  }
}

/**
 * The player's matches in a table, a page at a time, under three filters that work on the rows loaded so far (each
 * carries how many rows it shows), with the recorder beside them. A failure stays inside the part that failed.
 */
function PlayerMatches({ playerId }: { playerId: string }) {
  const t = useT()
  const player = usePlayer(playerId)
  const matches = usePlayerMatches(playerId)
  const [filter, setFilter] = useState<Filter>('all')
  // The `dataUpdatedAt` of the rows that have grown older than `STALE_AFTER_MS` while the refresh that would renew them
  // fails. Rows that are renewed have another time, so the line goes by itself. A timer, not a reading of the clock
  // while drawing: nothing redraws the page between two failed ticks.
  const [staleRows, setStaleRows] = useState<number | null>(null)
  const refreshFailing = matches.isRefetchError
  const loadedAt = matches.dataUpdatedAt
  useEffect(() => {
    if (!refreshFailing) {
      return
    }
    const timer = setTimeout(() => setStaleRows(loadedAt), Math.max(0, loadedAt + STALE_AFTER_MS - Date.now()))
    return () => clearTimeout(timer)
  }, [refreshFailing, loadedAt])
  const notUpdating = refreshFailing && staleRows === loadedAt
  // Offset paging can return the same match on two pages (each page is cached on its own), so keep the first.
  const items = matches.data?.pages
    .flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => other.matchId === item.matchId) === index)
  const shown = items?.filter((match) => isIn(filter, match))
  // A player that cannot be shown has no matches to show either: its error is the one message on the page.
  const playerFailed = player.isError && !player.data
  const labels: Record<Filter, string> = {
    all: t.matches.all,
    analyzed: t.demo.status.ANALYZED,
    needsDemo: t.matches.needsDemo,
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="heading-page">{t.matches.title}</h1>
        <div aria-live="polite">
          {player.isPending && <p className="label-mono">{t.player.loading}</p>}
          {player.data && (
            // The way back to the profile. The name is a small mono line, but 44px tall for the finger, and with 8px at its
            // sides, so that the focus ring does not touch the letters. The negative margins take back the 8px that the
            // box is taller than the title beside it and the 8px it is wider than its text on each side: the title keeps
            // its place, and under the title on a phone the letters start at the same edge as the title's.
            <Link
              to={`/players/${encodeURIComponent(playerId)}`}
              className="-mx-2 -my-1 inline-flex min-h-11 items-center px-2 font-mono text-xs text-subtle underline-offset-4 hover:text-foreground hover:underline"
            >
              {player.data.nickname}
            </Link>
          )}
        </div>
      </div>
      {playerFailed ? (
        <p className="text-sm text-destructive">{errorMessage(player.error, t)}</p>
      ) : (
        <div className="flex flex-wrap items-start gap-8">
          {/* The basis is the least the table needs (`min-w-205` of the table), so that the recorder goes under it where the
              table would have to scroll beside it. */}
          <div className="flex min-w-0 flex-[999_1_820px] flex-col gap-4">
            <div className="flex flex-col">
              {items && items.length > 0 && (
                // Toggle buttons that look like tabs (spec 3): 44px tall, a 2px light line under the chosen one. With
                // no match to filter they would do nothing, so they are not there.
                <div role="group" aria-label={t.matches.filterLabel} className="flex flex-wrap gap-1 border-b border-border">
                  {FILTERS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={filter === kind}
                      onClick={() => setFilter(kind)}
                      className="inline-flex min-h-11 items-center gap-2 px-3.5 text-sm font-medium text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:shadow-[inset_0_-2px_0_var(--foreground)]"
                    >
                      {labels[kind]}
                      <span className="font-mono text-xs text-subtle tabular-nums">
                        {items.filter((match) => isIn(kind, match)).length}
                        {/* Another page is still to come: the count is of what is loaded so far, so it is "20+". */}
                        {matches.hasNextPage && (
                          <>
                            <span aria-hidden="true">+</span>
                            <span className="sr-only"> {t.matches.loadedSoFar}</span>
                          </>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div aria-live="polite" className="flex flex-col gap-2">
                {matches.isPending && (
                  <>
                    <p className="label-mono">{t.player.loadingMatches}</p>
                    <Skeleton className="h-64 w-full" />
                  </>
                )}
                {shown && shown.length > 0 && <MatchesTable items={shown} />}
                {items && items.length === 0 && <p className="pt-4 text-sm text-muted-foreground">{t.matchList.empty}</p>}
                {items && items.length > 0 && shown?.length === 0 && (
                  <p className="pt-4 text-sm text-muted-foreground">{t.matches.emptyFilter}</p>
                )}
                {/* A failed refresh of rows that are already shown (the page asks again every 15 s while a clip is in
                    progress) says nothing at first: the rows are still good, and the next try is on its way. If the
                    refreshes go on failing until the rows are three intervals old, one quiet line says that the list is
                    not updating, and it goes when a refresh succeeds. The first page and a "load more" that fail are said
                    at once. */}
                {items && items.length > 0 && refreshFailing && notUpdating && (
                  <p className="text-sm text-muted-foreground">{t.matches.notUpdating}</p>
                )}
                {matches.isError && !matches.isRefetchError && (
                  <p className="text-sm text-destructive">{errorMessage(matches.error, t)}</p>
                )}
              </div>
            </div>
            {matches.hasNextPage && (
              <Button
                variant="outline"
                className="self-center"
                disabled={matches.isFetchingNextPage}
                onClick={() => matches.fetchNextPage()}
              >
                {t.player.loadMore}
              </Button>
            )}
          </div>
          <aside className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
            <RecorderCard />
          </aside>
        </div>
      )}
    </>
  )
}

/** The matches of one player: the page "Matchlar" of the design (screen 2). */
export default function MatchesPage() {
  const t = useT()
  const { playerId } = useParams()
  return (
    <main className="container-page flex flex-col gap-6 pt-9 pb-18">
      {playerId ? (
        // Keyed by the player: the chosen filter does not follow the visitor to another player's matches.
        <PlayerMatches key={playerId} playerId={playerId} />
      ) : (
        <>
          <h1 className="heading-page">{t.matches.title}</h1>
          <p className="text-sm text-destructive">{t.errors.playerNotFound}</p>
        </>
      )}
    </main>
  )
}
