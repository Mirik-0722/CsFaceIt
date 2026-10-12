import { useRecentClips } from '@/api/queries'
import ClipList from '@/components/ClipList'
import RecorderBanner from '@/components/RecorderBanner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'

/**
 * The finished clips of every player, newest first, under the state of the recorder. The tabs by state of the mockup
 * come with accounts: until a clip has an owner, the clips that are not finished are shown where they were asked for,
 * on the page of their match.
 */
export default function ClipsPage() {
  const t = useT()
  const clips = useRecentClips()
  // Offset paging can return the same clip on two pages (each page is cached on its own), so keep the first.
  const items = clips.data?.pages
    .flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
  return (
    <main className="container-page flex flex-col gap-6 pt-9 pb-18">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="heading-page">{t.clip.listTitle}</h1>
        <RecorderBanner boxed />
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {clips.isPending && (
          <>
            <p className="label-mono">{t.clip.loadingList}</p>
            <Skeleton className="h-64 w-full" />
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
    </main>
  )
}
