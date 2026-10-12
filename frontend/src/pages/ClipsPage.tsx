import { useState } from 'react'
import { useMe } from '@/api/auth'
import { usePlayerClips, useRecentClips } from '@/api/queries'
import type { ClipResponse } from '@/api/types'
import ClipList from '@/components/ClipList'
import RecorderBanner from '@/components/RecorderBanner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { isFinished } from '@/lib/clipStatus'
import { errorMessage } from '@/lib/errorMessage'

type Tab = 'all' | 'active' | 'ready' | 'failed'

const TABS: Tab[] = ['all', 'active', 'ready', 'failed']

/**
 * Whether a clip belongs under a tab: "in progress" is every state a clip passes through on its way to a video (queued,
 * recording, encoding, uploading), "ready" a clip that has its video, "failed" one that will not get any.
 */
function isIn(tab: Tab, clip: ClipResponse): boolean {
  switch (tab) {
    case 'active':
      return !isFinished(clip.status)
    case 'ready':
      return clip.status === 'DONE'
    case 'failed':
      return clip.status === 'FAILED'
    default:
      return true
  }
}

/** The loading state of the list, in the style of the page: a mono line and a block where the cards will be. */
function ClipsLoading() {
  const t = useT()
  return (
    <>
      <p className="label-mono">{t.clip.loadingList}</p>
      <Skeleton className="h-64 w-full" />
    </>
  )
}

/** Today's page, for a visitor who is not signed in or has no FACEIT player: the finished clips of everybody. */
function EveryoneClips() {
  const t = useT()
  const clips = useRecentClips()
  // Offset paging can return the same clip on two pages (each page is cached on its own), so keep the first.
  const items = clips.data?.pages
    .flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
  return (
    <>
      <div aria-live="polite" className="flex flex-col gap-2">
        {clips.isPending && <ClipsLoading />}
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
    </>
  )
}

/**
 * The signed-in player's own clips in whatever state, newest first, under tabs by state (the page "Kliplar" of the
 * design). The tabs work on the clips loaded so far and carry how many each shows, as the filters of the matches page
 * do. The list is asked for again by itself while a clip is on its way, so a clip moves from tab to tab as it goes.
 */
function PlayerClips({ playerId }: { playerId: string }) {
  const t = useT()
  const clips = usePlayerClips(playerId)
  const [tab, setTab] = useState<Tab>('all')
  // Offset paging can return the same clip on two pages (each page is cached on its own), so keep the first.
  const items = clips.data?.pages
    .flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
  const shown = items?.filter((clip) => isIn(tab, clip))
  const labels: Record<Tab, string> = {
    all: t.clip.tabs.all,
    active: t.clip.tabs.active,
    ready: t.clip.tabs.ready,
    failed: t.clip.tabs.failed,
  }
  const emptyTexts: Record<Tab, string> = {
    all: t.clip.empty,
    active: t.clip.tabs.emptyActive,
    ready: t.clip.tabs.emptyReady,
    failed: t.clip.tabs.emptyFailed,
  }
  // A player without a clip of their own gets the page everybody gets, not an empty one: the finished clips of every
  // player.
  if (items?.length === 0 && !clips.hasNextPage) {
    return <EveryoneClips />
  }
  return (
    <>
      {items && (
        // Toggle buttons that look like tabs (spec 3), as on the matches page: 44px tall, a 2px light line under the
        // chosen one.
        <div role="group" aria-label={t.clip.tabs.label} className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={tab === kind}
              onClick={() => setTab(kind)}
              className="inline-flex min-h-11 items-center gap-2 px-3.5 text-sm font-medium text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:shadow-[inset_0_-2px_0_var(--foreground)]"
            >
              {labels[kind]}
              <span className="font-mono text-xs font-normal text-subtle tabular-nums">
                {items.filter((clip) => isIn(kind, clip)).length}
              </span>
            </button>
          ))}
        </div>
      )}
      <div aria-live="polite" className="flex flex-col gap-2">
        {clips.isPending && <ClipsLoading />}
        {shown && shown.length > 0 && <ClipList items={shown} />}
        {shown?.length === 0 && <p className="text-sm text-muted-foreground">{emptyTexts[tab]}</p>}
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
    </>
  )
}

/**
 * The page "Kliplar" of the design. A signed-in visitor with a FACEIT player sees that player's clips in every state
 * under tabs by state; everybody else, and a player who has no clip yet, sees the finished clips of every player, as
 * before. The state of the recorder stays beside the title in both.
 */
export default function ClipsPage() {
  const t = useT()
  const me = useMe()
  // A failed answer leaves no visitor in `data`, and the page then draws itself as for one who is not signed in.
  const playerId = me.data?.playerId ?? null
  return (
    <main className="container-page flex flex-col gap-6 pt-9 pb-18">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="heading-page">{t.clip.listTitle}</h1>
        <RecorderBanner boxed />
      </div>
      {me.isPending ? (
        <div aria-live="polite" className="flex flex-col gap-2">
          <ClipsLoading />
        </div>
      ) : playerId ? (
        // Keyed by the player: the chosen tab does not follow the page to the clips of another account.
        <PlayerClips key={playerId} playerId={playerId} />
      ) : (
        <EveryoneClips />
      )}
    </main>
  )
}
