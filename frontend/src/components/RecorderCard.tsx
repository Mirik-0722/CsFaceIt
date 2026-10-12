import { useRecorderStatus } from '@/api/queries'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'

/**
 * The recording PC as a card beside a list of matches (spec 3, RecorderStatus, the card form): whether it is online, how
 * many clips it is recording and how many wait. Without a recorder the dot is grey and the word says so; the two counts
 * stay, because clips wait in the queue for a recorder to come back. A failure stays inside the card.
 */
export default function RecorderCard() {
  const t = useT()
  const recorder = useRecorderStatus()
  const status = recorder.data
  return (
    <section className="flex flex-col gap-3.5 border border-border bg-card p-5">
      <h2 className="label-mono font-medium">{t.matches.recorder.title}</h2>
      {/* The answer is asked for again every minute; a change is announced, the same answer is not. */}
      <div aria-live="polite" className="flex flex-col gap-3.5">
        {recorder.isPending && (
          <div className="flex flex-col gap-2">
            <p className="label-mono">{t.matches.recorder.loading}</p>
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {status && (
          <>
            <p className="flex items-center gap-2.5 text-[17px] font-semibold">
              <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', status.online ? 'bg-positive' : 'bg-ring')} />
              {status.online ? t.matches.recorder.online : t.matches.recorder.offline}
            </p>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t.matches.recorder.active}</dt>
              <dd className="text-right font-mono">{status.active}</dd>
              <dt className="text-muted-foreground">{t.matches.recorder.queued}</dt>
              <dd className="text-right font-mono">{status.queued}</dd>
            </dl>
          </>
        )}
        {recorder.isError && !status && <p className="text-sm text-destructive">{errorMessage(recorder.error, t)}</p>}
      </div>
    </section>
  )
}
