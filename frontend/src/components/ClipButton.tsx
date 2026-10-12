import { Link } from 'react-router-dom'
import RecDot from '@/components/RecDot'
import StatusChip from '@/components/StatusChip'
import { Button, buttonVariants } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ClipResponse } from '@/api/types'

interface ClipButtonProps {
  /** The clip of the highlight or the compilation, when there is one. */
  clip: ClipResponse | undefined
  /** Opens the order of the clip: the first one, or another attempt after a failure. */
  onOrder: () => void
  /** What the button that records says; "Record clip" when left out. */
  label?: string
  /** The look of the button that records: filled on a highlight card, an outline where it is a second action. */
  variant?: 'default' | 'outline'
  /**
   * What the clip is of (`4K · nickname · Round 14`), where a page has many of these rows: it is added to the name of
   * the button or link, so that a list of the page's controls does not read "Record clip" thirty times.
   */
  subject?: string
}

/**
 * What can be done about the clip of a highlight, as the last row of its card, or about a compilation: record it
 * while there is none, follow it while it is queued or being recorded (the row then links to the clip's page), watch
 * it once it is ready, and try again after a failure.
 */
export default function ClipButton({ clip, onOrder, label, variant = 'default', subject }: ClipButtonProps) {
  const t = useT()
  // The name starts with the words on the control, so that it can still be asked for by what it shows.
  const named = (words: string) => (subject ? `${words}: ${subject}` : undefined)
  if (!clip) {
    return (
      <Button type="button" variant={variant} aria-label={named(label ?? t.clip.record)} onClick={onOrder}>
        <RecDot />
        {label ?? t.clip.record}
      </Button>
    )
  }
  if (clip.status === 'DONE') {
    return (
      <>
        {/* `cn` settles the border of the variant against the transparent one every button starts with. */}
        <Link
          to={`/clips/${clip.id}`}
          aria-label={named(t.clip.watch)}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
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
        <Button
          type="button"
          variant="link"
          size="sm"
          className="-mr-3.5"
          aria-label={named(t.clip.retry)}
          onClick={onOrder}
        >
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
