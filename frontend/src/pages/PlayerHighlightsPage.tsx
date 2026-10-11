import { useId, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePlayer, usePlayerHighlights } from '@/api/queries'
import HighlightList from '@/components/HighlightList'
import PlayerHeader from '@/components/PlayerHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'
import { HIGHLIGHT_TYPES, highlightLabel, isHighlightType } from '@/lib/highlightLabels'
import type { HighlightType } from '@/api/types'

function PlayerHighlights({ playerId }: { playerId: string }) {
  const t = useT()
  const typeId = useId()
  const [type, setType] = useState<HighlightType | null>(null)
  const player = usePlayer(playerId)
  const highlights = usePlayerHighlights(playerId, type)
  // Offset paging can return the same highlight on two pages (each page is cached on its own), so keep the first.
  const items = highlights.data?.pages
    .flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
  // A player that cannot be shown has no highlights to show either: its error is the one message on the page.
  const playerFailed = player.isError && !player.data

  return (
    <>
      <div aria-live="polite">
        {player.isPending && (
          <>
            <p className="label-mono mb-2">{t.player.loading}</p>
            <Skeleton className="h-20 w-full" />
          </>
        )}
        {playerFailed && <p className="text-sm text-destructive">{errorMessage(player.error, t)}</p>}
        {/* The card is the way back to the profile, as it is the way there on the search page. */}
        {player.data && (
          <Link to={`/players/${encodeURIComponent(playerId)}`} className="block">
            <PlayerHeader player={player.data} />
          </Link>
        )}
      </div>
      {!playerFailed && (
        <section className="flex flex-col gap-4 pt-3">
          {/* The cards are h3, as on the other pages; this is the h2 they belong to, for navigation by headings. */}
          <h2 className="sr-only">{t.highlight.title}</h2>
          {/* The filter is answered by the server: a kind that is rare would hide among the pages otherwise. */}
          <div className="flex flex-col gap-1.5 self-start">
            <label htmlFor={typeId} className="label-mono">
              {t.highlight.typeLabel}
            </label>
            <select
              id={typeId}
              value={type ?? ''}
              onChange={(event) => setType(isHighlightType(event.target.value) ? event.target.value : null)}
              className="h-11 min-w-48 rounded-lg border border-border bg-card px-3 text-base text-foreground"
            >
              <option value="">{t.highlight.anyType}</option>
              {HIGHLIGHT_TYPES.map((option) => (
                <option key={option} value={option}>
                  {highlightLabel(option, t)}
                </option>
              ))}
            </select>
          </div>
          <div aria-live="polite" className="flex flex-col gap-2">
            {highlights.isPending && (
              <>
                <p className="label-mono">{t.highlight.loading}</p>
                <Skeleton className="h-40 w-full" />
              </>
            )}
            {items && <HighlightList items={items} showMatch />}
            {highlights.isError && <p className="text-sm text-destructive">{errorMessage(highlights.error, t)}</p>}
          </div>
          {highlights.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              disabled={highlights.isFetchingNextPage}
              onClick={() => highlights.fetchNextPage()}
            >
              {t.player.loadMore}
            </Button>
          )}
        </section>
      )}
    </>
  )
}

/** Every highlight of one player, newest match first, with a filter by type. */
export default function PlayerHighlightsPage() {
  const t = useT()
  const { playerId } = useParams()
  return (
    // The nickname in the header is the page's big title, so the h1 is a small label above it.
    <main className="container-page flex flex-col gap-4 pt-9 pb-18">
      <h1 className="label-mono">{t.highlight.playerTitle}</h1>
      {playerId ? (
        // Keyed by the player: the chosen type does not follow the visitor to another player's highlights.
        <PlayerHighlights key={playerId} playerId={playerId} />
      ) : (
        <p className="text-sm text-destructive">{t.errors.playerNotFound}</p>
      )}
    </main>
  )
}
