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
        'flex items-center font-mono text-xs text-muted-foreground',
        boxed && 'min-h-11 border border-border px-4 py-2',
        className,
      )}
    >
      {/* One run of text that wraps like a sentence; the dot stays beside its first line. */}
      <span className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={cn('mt-1 size-2 shrink-0 rounded-full', status.online ? 'bg-positive' : 'bg-ring')}
        />
        <span>
          <span className="text-foreground">
            {status.online ? t.clip.recorder.online : waiting ? t.clip.recorder.offlineQueued : t.clip.recorder.offline}
          </span>
          {status.active > 0 && ` · ${t.clip.recorder.active(status.active)}`}
          {(status.online || status.queued > 0) && ` · ${t.clip.recorder.queued(status.queued)}`}
        </span>
      </span>
    </p>
  )
}
