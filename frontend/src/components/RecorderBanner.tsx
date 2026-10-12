import { useRecorderStatus } from '@/api/queries'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * The recorder in one line (spec 3, RecorderStatus): a dot and `Recorder online · recording 1 · 2 queued`. Without a
 * recorder the dot is grey and the line says so; when clips are waiting then, it says that they wait. Nothing is shown
 * until the first answer has arrived, or when there is none: the line is a remark beside the page, not a part of it.
 * `boxed` draws the outline it has at the top of the clips page.
 */
export default function RecorderBanner({ boxed = false, className }: { boxed?: boolean; className?: string }) {
  const t = useT()
  const recorder = useRecorderStatus()
  const status = recorder.data
  if (!status) {
    return null
  }
  const waiting = status.queued + status.active > 0
  return (
    // The answer is asked for again every minute; a change of the line is announced, the same line is not.
    <p
      aria-live="polite"
      className={cn(
        'flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs text-muted-foreground',
        boxed && 'min-h-11 border border-border px-4 py-2',
        className,
      )}
    >
      <span className="inline-flex items-center gap-2 text-foreground">
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-full', status.online ? 'bg-positive' : 'bg-ring')}
        />
        {status.online ? t.clip.recorder.online : waiting ? t.clip.recorder.offlineQueued : t.clip.recorder.offline}
      </span>
      {status.active > 0 && <span>{t.clip.recorder.active(status.active)}</span>}
      {(status.online || status.queued > 0) && <span>{t.clip.recorder.queued(status.queued)}</span>}
    </p>
  )
}
