import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  CLIPS_POLL_MS,
  isParsedStalled,
  noteParsedRows,
  PARSED_STALLED_MS,
  type ParsedSeen,
  type PlayerMatchResponse,
  usePlayerMatches,
  useSyncMatches,
} from '@/api/overview'
import { useMe } from '@/api/auth'
import { usePlayer } from '@/api/queries'
import Cs2LinkBox from '@/components/Cs2LinkBox'
import DemoBringingFeed from '@/components/DemoBringingFeed'
import DemoDropOverlay from '@/components/DemoDropOverlay'
import DemoUploadBox from '@/components/DemoUploadBox'
import MatchesTable from '@/components/MatchesTable'
import RecorderCard from '@/components/RecorderCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'
import { isSteamPlayer, playerPath, steamPlayerId } from '@/lib/matchSource'
import { useDemoBringing } from '@/lib/useDemoBringing'
import { useViewer } from '@/lib/viewer'

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
 * carries how many rows it shows), with the recorder beside them. The signed-in player's own matches also bring demos
 * in: a box beside the rows, an action on the rows that have none, and the whole page as a place to drop a file on;
 * beside them, the section that links the visitor's CS2 matchmaking games. A failure stays inside the part that failed.
 */
function PlayerMatches({ playerId }: { playerId: string }) {
  const t = useT()
  const player = usePlayer(playerId)
  // The player's own page: the matches are the visitor's, so the visitor's demos can be brought for them, and the
  // visitor's CS2 matchmaking games linked. The visitor's own player is the FACEIT one, or the one an account without
  // FACEIT is known by (`steam:` and its SteamID).
  const viewer = useViewer()
  const me = useMe().data
  const ownSteam = me?.steamId ? playerId === steamPlayerId(me.steamId) : false
  const own = viewer.signedIn && (viewer.playerId === playerId || ownSteam)
  const linkOwner = own && me ? me.id : null
  // When this page first saw each PARSED row: one that stays PARSED for 30 minutes is shown as nothing is going on.
  // A map that is kept for the page's life and changed in place, so that it is a state only to stay the same object.
  const [parsedSeen] = useState<ParsedSeen>(() => new Map())
  const matches = usePlayerMatches(playerId, undefined, own, parsedSeen)
  const [filter, setFilter] = useState<Filter>('all')
  const [now, setNow] = useState(() => Date.now())
  // The sync fetches the visitor's FACEIT matches: there are none behind a `steam:` page.
  useSyncMatches(playerId, own && !isSteamPlayer(playerId))
  const rowInput = useRef<HTMLInputElement>(null)
  // The match the chooser of a row's action was opened for.
  const rowMatch = useRef<string | null>(null)
  // The `dataUpdatedAt` of the rows that have grown older than `STALE_AFTER_MS` while the refresh that would renew them
  // fails. Rows that are renewed have another time, so the line goes by itself. A timer, not a reading of the clock
  // while drawing: nothing redraws the page between two failed ticks.
  const [staleRows, setStaleRows] = useState<number | null>(null)
  // A failed "load more" also has rows and an error; it is not a refresh, and it is said at once.
  const refreshFailing = matches.isRefetchError && !matches.isFetchNextPageError
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
  // The row that reaches its 30 minutes has no new answer to be drawn again by, so a timer renews the clock for it.
  // It depends on the cached answer and not on `items`, which is a new array at every render.
  const pages = matches.data?.pages
  useEffect(() => {
    if (!pages) {
      return
    }
    const loaded = pages.flatMap((page) => page.items)
    noteParsedRows(parsedSeen, loaded, Date.now())
    const due = loaded
      .filter((match) => match.demoStatus === 'PARSED')
      .map((match) => (parsedSeen.get(`${match.matchId}:PARSED`) ?? 0) + PARSED_STALLED_MS)
      .filter((at) => at > Date.now())
    if (due.length === 0) {
      return
    }
    const timer = setTimeout(() => setNow(Date.now()), Math.min(...due) - Date.now() + 100)
    return () => clearTimeout(timer)
  }, [pages, now, parsedSeen])
  // The one list is complete when no page is left to load: a match that is not in it is not the visitor's.
  const bring = useDemoBringing(items, matches.data !== undefined && !matches.hasNextPage)
  function bringFiles(files: File[]) {
    for (const file of files) {
      bring.bringFile(file)
    }
  }
  // A player that cannot be shown has no matches to show either: its error is the one message on the page. Not so the
  // visitor's own `steam:` player before the first of its demos has been read: the database has no row for it yet, and
  // the page is where that first demo is brought (the list is empty, the upload box and the CS2 link are there).
  // Whose `steam:` page this is is known only once `/auth/me` has answered: until then the page is loading, so that a
  // missing player is neither said nor drawn for its own visitor.
  const waitingForMe = isSteamPlayer(playerId) && viewer.loading
  const playerFailed =
    !waitingForMe && player.isError && !player.data && !(ownSteam && player.error.code === 'PLAYER_NOT_FOUND')
  const labels: Record<Filter, string> = {
    all: t.matches.all,
    analyzed: t.demo.status.ANALYZED,
    needsDemo: t.matches.needsDemo,
  }

  return (
    <>
      {own && <DemoDropOverlay onFiles={bringFiles} />}
      {own && (
        <input
          ref={rowInput}
          type="file"
          accept=".dem,.gz,.zst,.bz2"
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file && rowMatch.current !== null) {
              bring.bringFile(file, rowMatch.current)
            }
            event.target.value = ''
          }}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="heading-page">{t.matches.title}</h1>
        <div aria-live="polite">
          {(player.isPending || (waitingForMe && !player.data)) && <p className="label-mono">{t.player.loading}</p>}
          {player.data && (
            // The way back to the profile. The name is a small mono line, but 44px tall for the finger, and with 8px at its
            // sides, so that the focus ring does not touch the letters. The negative margins take back the 8px that the
            // box is taller than the title beside it and the 8px it is wider than its text on each side: the title keeps
            // its place, and under the title on a phone the letters start at the same edge as the title's.
            <Link
              to={playerPath(playerId)}
              className="-mx-2 -my-1 inline-flex min-h-11 items-center px-2 font-mono text-xs text-subtle underline-offset-4 hover:text-foreground hover:underline"
            >
              {player.data.nickname}
            </Link>
          )}
        </div>
      </div>
      {waitingForMe ? (
        <div className="flex flex-col gap-2">
          <p className="label-mono">{t.player.loadingMatches}</p>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : playerFailed ? (
        <p className="text-sm text-destructive">{errorMessage(player.error, t)}</p>
      ) : (
        <div className="flex flex-wrap items-start gap-8">
          {/* The basis is the least the table needs (`min-w-205` of the table), so that the recorder goes under it where the
              table would have to scroll beside it. */}
          <div className="flex min-w-0 flex-[999_1_820px] flex-col gap-4">
            <div className="flex flex-col">
              {items && items.length > 0 && (
                // Toggle buttons that look like tabs (spec 3): 44px tall, a 2px light line under the chosen one. With
                // no match to filter they would do nothing, so they are not there. On a phone (spec of the phone view, 4)
                // they are pills on one line that scrolls sideways, from the edge of the page's text to the edge of the
                // screen: 36px to the eye, the chosen one filled, with 4px above and below each that still press it (so
                // the finger has 44px) and that leave the focus ring room inside the scrolling box.
                <div
                  role="group"
                  aria-label={t.matches.filterLabel}
                  className="flex flex-wrap gap-1 border-b border-border max-md:-mx-(--page-gutter) max-md:flex-nowrap max-md:gap-2 max-md:overflow-x-auto max-md:border-b-0 max-md:px-(--page-gutter)"
                >
                  {FILTERS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={filter === kind}
                      onClick={() => setFilter(kind)}
                      className="group/filter inline-flex min-h-11 items-center gap-2 px-3.5 text-sm font-medium text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:shadow-[inset_0_-2px_0_var(--foreground)] max-md:relative max-md:my-1 max-md:min-h-9 max-md:shrink-0 max-md:rounded-full max-md:border max-md:border-border max-md:after:absolute max-md:after:inset-x-0 max-md:after:-inset-y-1 max-md:aria-pressed:border-primary max-md:aria-pressed:bg-primary max-md:aria-pressed:text-primary-foreground max-md:aria-pressed:shadow-none max-md:aria-pressed:hover:text-primary-foreground"
                    >
                      {labels[kind]}
                      <span className="font-mono text-xs text-subtle tabular-nums max-md:group-aria-pressed/filter:text-primary-foreground/70">
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
              {own && (
                <DemoBringingFeed
                  states={bring.states}
                  notice={bring.notice}
                  items={items ?? []}
                  onDismiss={bring.dismiss}
                  onDismissNotice={bring.dismissNotice}
                />
              )}
              <div aria-live="polite" className="flex flex-col gap-2">
                {matches.isPending && (
                  <>
                    <p className="label-mono">{t.player.loadingMatches}</p>
                    <Skeleton className="h-64 w-full" />
                  </>
                )}
                {shown && shown.length > 0 && (
                  <MatchesTable
                    items={shown}
                    stalled={(match) => isParsedStalled(parsedSeen, match, now)}
                    bringing={
                      own
                        ? {
                            states: bring.states,
                            pick: (matchId) => {
                              rowMatch.current = matchId
                              rowInput.current?.click()
                            },
                          }
                        : undefined
                    }
                  />
                )}
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
                {matches.isError && !refreshFailing && (
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
            {own && <DemoUploadBox onFile={bring.bringFile} onLink={bring.bringLink} />}
            {linkOwner !== null && <Cs2LinkBox userId={linkOwner} />}
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
