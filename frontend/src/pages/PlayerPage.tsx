import { useParams } from 'react-router-dom'
import { usePlayer, usePlayerHistory } from '@/api/queries'
import MatchList from '@/components/MatchList'
import PlayerHeader from '@/components/PlayerHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage, PLAYER_NOT_FOUND_MESSAGE } from '@/lib/errorMessage'

function PlayerProfile({ playerId }: { playerId: string }) {
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
            <Skeleton className="h-20 w-full" />
            <span className="sr-only">Loading player…</span>
          </>
        )}
        {playerFailed && <p className="text-sm text-destructive">{errorMessage(player.error)}</p>}
        {player.data && <PlayerHeader player={player.data} />}
      </div>
      {!playerFailed && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Match history</h2>
          <div aria-live="polite" className="flex flex-col gap-3">
            {history.isPending && (
              <>
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <span className="sr-only">Loading matches…</span>
              </>
            )}
            {matches && <MatchList items={matches} />}
            {history.isError && <p className="text-sm text-destructive">{errorMessage(history.error)}</p>}
          </div>
          {history.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              disabled={history.isFetchingNextPage}
              onClick={() => history.fetchNextPage()}
            >
              Load more
            </Button>
          )}
        </section>
      )}
    </>
  )
}

export default function PlayerPage() {
  const { playerId } = useParams()
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Player profile</h1>
      {playerId ? (
        <PlayerProfile playerId={playerId} />
      ) : (
        <p className="text-sm text-destructive">{PLAYER_NOT_FOUND_MESSAGE}</p>
      )}
    </main>
  )
}
