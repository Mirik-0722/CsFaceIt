import { useParams } from 'react-router-dom'
import { usePlayer, usePlayerHistory } from '@/api/queries'
import MatchList from '@/components/MatchList'
import PlayerHeader from '@/components/PlayerHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'

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
            <Skeleton className="h-26 w-full" />
            <span className="sr-only">{t.player.loading}</span>
          </>
        )}
        {playerFailed && <p className="text-sm text-destructive">{errorMessage(player.error, t)}</p>}
        {player.data && <PlayerHeader player={player.data} size="lg" />}
      </div>
      {!playerFailed && (
        <section className="flex flex-col gap-4 pt-3">
          <h2 className="text-[22px] leading-[1.3] font-semibold tracking-[-0.01em]">{t.player.history}</h2>
          <div aria-live="polite" className="flex flex-col gap-3">
            {history.isPending && (
              <>
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <span className="sr-only">{t.player.loadingMatches}</span>
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
    <main className="container-page pt-9 pb-18">
      {/* The nickname in the header is the page's big title, so the h1 is a small label above it. */}
      <div className="flex max-w-[880px] flex-col gap-4">
        <h1 className="label-mono">{t.player.title}</h1>
        {playerId ? (
          <PlayerProfile playerId={playerId} />
        ) : (
          <p className="text-sm text-destructive">{t.errors.playerNotFound}</p>
        )}
      </div>
    </main>
  )
}
