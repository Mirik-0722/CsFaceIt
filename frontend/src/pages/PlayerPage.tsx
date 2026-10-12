import { Link, useParams } from 'react-router-dom'
import { usePlayer, usePlayerClips, usePlayerHighlights, usePlayerHistory, usePlayerStats } from '@/api/queries'
import ClipList from '@/components/ClipList'
import HighlightList from '@/components/HighlightList'
import MatchList from '@/components/MatchList'
import PlayerHeader from '@/components/PlayerHeader'
import StatsCards from '@/components/StatsCards'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'

/**
 * How many of the newest highlights the profile shows; all of them are on the highlights page. Six fill one, two or
 * three columns of the grid without leaving a card alone on the last row.
 */
const LATEST_HIGHLIGHTS = 6

/** The player's figures over the stored matches. A failure stays inside the section: the rest of the page stands. */
function PlayerStats({ playerId }: { playerId: string }) {
  const t = useT()
  const stats = usePlayerStats(playerId)
  return (
    <section className="flex flex-col gap-4 pt-3">
      <h2 className="heading-section">{t.statsCards.title}</h2>
      <div aria-live="polite" className="flex flex-col gap-2">
        {stats.isPending && (
          <>
            <p className="label-mono">{t.statsCards.loading}</p>
            <Skeleton className="h-44 w-full" />
          </>
        )}
        {stats.data && <StatsCards stats={stats.data} />}
        {stats.isError && !stats.data && <p className="text-sm text-destructive">{errorMessage(stats.error, t)}</p>}
      </div>
    </section>
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

/** The player's clips, in whatever state, newest first, a page at a time. A failure stays inside the section. */
function PlayerClips({ playerId }: { playerId: string }) {
  const t = useT()
  const clips = usePlayerClips(playerId)
  // Offset paging can return the same clip on two pages (each page is cached on its own), so keep the first.
  const items = clips.data?.pages
    .flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
  return (
    <section className="flex flex-col gap-4 pt-3">
      <h2 className="heading-section">{t.clip.listTitle}</h2>
      <div aria-live="polite" className="flex flex-col gap-2">
        {clips.isPending && (
          <>
            <p className="label-mono">{t.clip.loadingList}</p>
            <Skeleton className="h-40 w-full" />
          </>
        )}
        {items && <ClipList items={items} />}
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

function PlayerProfile({ playerId }: { playerId: string }) {
  const t = useT()
  const player = usePlayer(playerId)
  const history = usePlayerHistory(playerId)
  // Offset paging can return the same match on two pages (each page is cached on its own), so keep the first.
  const matches = history.data?.pages
    .flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => other.matchId === item.matchId) === index)
  // A player that cannot be shown has no history to show either: its error is the one message on the page.
  const playerFailed = player.isError && !player.data

  return (
    <>
      <div aria-live="polite">
        {player.isPending && (
          <>
            <p className="label-mono mb-2">{t.player.loading}</p>
            <Skeleton className="h-26 w-full" />
          </>
        )}
        {playerFailed && <p className="text-sm text-destructive">{errorMessage(player.error, t)}</p>}
        {player.data && <PlayerHeader player={player.data} size="lg" />}
      </div>
      {!playerFailed && <PlayerStats playerId={playerId} />}
      {!playerFailed && <LatestHighlights playerId={playerId} />}
      {!playerFailed && <PlayerClips playerId={playerId} />}
      {!playerFailed && (
        <section className="flex flex-col gap-4 pt-3">
          <h2 className="heading-section">{t.player.history}</h2>
          <div aria-live="polite" className="flex flex-col gap-2">
            {history.isPending && (
              <>
                <p className="label-mono">{t.player.loadingMatches}</p>
                {/* 12px between the rows of the placeholder, 8px under its label as under every loading label. */}
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              </>
            )}
            {matches && <MatchList items={matches} />}
            {history.isError && <p className="text-sm text-destructive">{errorMessage(history.error, t)}</p>}
          </div>
          {history.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              disabled={history.isFetchingNextPage}
              onClick={() => history.fetchNextPage()}
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
    // The nickname in the header is the page's big title, so the h1 is a small label above it.
    <main className="container-page flex flex-col gap-4 pt-9 pb-18">
      <h1 className="label-mono">{t.player.title}</h1>
      {playerId ? (
        <PlayerProfile playerId={playerId} />
      ) : (
        <p className="text-sm text-destructive">{t.errors.playerNotFound}</p>
      )}
    </main>
  )
}
