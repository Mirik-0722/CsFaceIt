import { Link } from 'react-router-dom'
import RecDot from '@/components/RecDot'
import StatusChip from '@/components/StatusChip'
import { Button, buttonVariants } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ClipResponse } from '@/api/types'

interface ClipButtonProps {
  /** The clip of the highlight, when it has one. */
  clip: ClipResponse | undefined
  /** Opens the order of a clip for the highlight: the first one, or another attempt after a failure. */
  onOrder: () => void
}

/**
 * What can be done about the clip of a highlight, as the last row of its card: record it while there is none, follow
 * it while it is queued or being recorded (the row then links to the clip's page), watch it once it is ready, and try
 * again after a failure.
 */
export default function ClipButton({ clip, onOrder }: ClipButtonProps) {
  const t = useT()
  if (!clip) {
    return (
      <Button type="button" onClick={onOrder}>
        <RecDot />
        {t.clip.record}
      </Button>
    )
  }
  if (clip.status === 'DONE') {
    return (
      <>
        {/* `cn` settles the border of the variant against the transparent one every button starts with. */}
        <Link to={`/clips/${clip.id}`} className={cn(buttonVariants({ variant: 'outline' }))}>
          <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 fill-current">
            <path d="M3 1.5v9l7.5-4.5z" />
          </svg>
          {t.clip.watch}
        </Link>
        <span className="flex min-w-0 items-center gap-2">
          <StatusChip clip={clip} />
          <span className="font-mono text-[11px] tracking-[0.06em] text-positive">· {clip.quality}</span>
        </span>
      </>
    )
  }
  if (clip.status === 'FAILED') {
    return (
      <>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <StatusChip clip={clip} />
          {/* The recorder's own words about what went wrong, as they are: a technical message. */}
          {clip.error && (
            <span title={clip.error} className="min-w-0 truncate font-mono text-[11px] text-subtle">
              {clip.error}
            </span>
          )}
        </span>
        <Button type="button" variant="link" size="sm" className="-mr-3.5" onClick={onOrder}>
          {t.clip.retry}
        </Button>
      </>
    )
  }
  return (
    // Queued or being recorded: the row is the way to the clip's page, where the same state is shown large.
    <Link to={`/clips/${clip.id}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 -outline-offset-2">
      <StatusChip clip={clip} />
      {clip.status === 'RECORDING' && (
        <span aria-hidden="true" className="block h-0.5 min-w-8 flex-1 bg-line-strong">
          <span className="block h-0.5 bg-rec" style={{ width: `${clip.progress}%` }} />
        </span>
      )}
    </Link>
  )
}
