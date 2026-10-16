import { Link } from 'react-router-dom'
import RecDot from '@/components/RecDot'
import StatusChip from '@/components/StatusChip'
import { Button, buttonVariants } from '@/components/ui/button'
import { useT } from '@/i18n'
import { clipFailureText, qualityMark } from '@/lib/clips'
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
  /**
   * Whether the visitor has a way to order this clip; true when left out. False for a signed-in visitor without the
   * admin key whose clip this could not be (another player's highlight): the button that records and "Try again" are
   * then left out, since the order dialog would only refuse; what there is to follow or watch stays.
   */
  canOrder?: boolean
  /** Added to the button that records and to "Watch" (a fill for an outline that stands on a picture). */
  className?: string
}

/**
 * What can be done about the clip of a highlight, as the last row of its card, or about a compilation: record it
 * while there is none, follow it while it is queued or being recorded (the row then links to the clip's page), watch
 * it once it is ready, and try again after a failure.
 *
 * On a phone, in the 44px place at the end of a highlight's row (`data-row-action`, phone spec 5.1), the same controls
 * are drawn compact by `max-md:in-data-row-action:` classes: a white square with the red dot, a green-edged ▶, the
 * percentage or "Queued" in mono, and "Retry"; the words of the desktop stay for a screen reader, the lines beside the
 * controls are left out. The compilation panel, which shows the same states, keeps its look.
 */
export default function ClipButton({
  clip,
  onOrder,
  label,
  variant = 'default',
  subject,
  canOrder = true,
  className,
}: ClipButtonProps) {
  const t = useT()
  // The name starts with the words on the control, so that it can still be asked for by what it shows.
  const named = (words: string) => (subject ? `${words}: ${subject}` : undefined)
  if (!clip) {
    if (!canOrder) {
      return null
    }
    return (
      <Button
        type="button"
        variant={variant}
        aria-label={named(label ?? t.clip.record)}
        onClick={onOrder}
        className={cn('max-md:in-data-row-action:size-11 max-md:in-data-row-action:px-0', className)}
      >
        <RecDot />
        <span className="max-md:in-data-row-action:sr-only">{label ?? t.clip.record}</span>
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
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'max-md:in-data-row-action:size-11 max-md:in-data-row-action:border-positive max-md:in-data-row-action:px-0 max-md:in-data-row-action:text-positive',
            className,
          )}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 fill-current max-md:in-data-row-action:size-3.5">
            <path d="M3 1.5v9l7.5-4.5z" />
          </svg>
          <span className="max-md:in-data-row-action:sr-only">{t.clip.watch}</span>
        </Link>
        <span className="flex min-w-0 items-center gap-2 max-md:in-data-row-action:hidden">
          <StatusChip clip={clip} />
          <span className="font-mono text-[11px] tracking-[0.06em] text-positive">· {qualityMark(clip)}</span>
        </span>
      </>
    )
  }
  if (clip.status === 'FAILED') {
    // In the visitor's language when the backend gave the reason a code, else the recorder's own words, as they are.
    const failure = clipFailureText(clip, t)
    return (
      <>
        {/* On a phone the state is the word "Retry" of the button; without the button, the red word of the chip. */}
        <span
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2',
            canOrder ? 'max-md:in-data-row-action:hidden' : 'max-md:in-data-row-action:flex-none',
          )}
        >
          <StatusChip clip={clip} />
          {failure && (
            <span
              title={failure}
              className="min-w-0 truncate font-mono text-[11px] text-subtle max-md:in-data-row-action:hidden"
            >
              {failure}
            </span>
          )}
        </span>
        {canOrder && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="-mr-3.5 max-md:in-data-row-action:mr-0 max-md:in-data-row-action:min-w-11 max-md:in-data-row-action:px-1"
            aria-label={named(t.clip.retry)}
            onClick={onOrder}
          >
            <span className="max-md:in-data-row-action:hidden">{t.clip.retry}</span>
            <span className="hidden max-md:in-data-row-action:inline">{t.phoneRow.retry}</span>
          </Button>
        )}
      </>
    )
  }
  return (
    // Queued or being recorded: the row is the way to the clip's page, where the same state is shown large. On a
    // phone the link is the place at the end of the row, with the percentage or "Queued" in it; the chip stays for a
    // screen reader, so that the link keeps its name.
    <Link
      to={`/clips/${clip.id}`}
      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 -outline-offset-2 max-md:in-data-row-action:min-w-11 max-md:in-data-row-action:flex-none max-md:in-data-row-action:justify-center"
    >
      <StatusChip clip={clip} className="max-md:in-data-row-action:sr-only" />
      {clip.status === 'RECORDING' && (
        <span aria-hidden="true" className="block h-0.5 min-w-8 flex-1 bg-line-strong max-md:in-data-row-action:hidden">
          <span className="block h-0.5 bg-rec" style={{ width: `${clip.progress}%` }} />
        </span>
      )}
      <span
        aria-hidden="true"
        className={cn(
          'hidden font-mono text-[11px] tabular-nums max-md:in-data-row-action:inline',
          clip.status === 'QUEUED' ? 'text-muted-foreground' : clip.status === 'RECORDING' ? 'text-rec' : 'text-foreground',
        )}
      >
        {clip.status === 'QUEUED' ? t.phoneRow.queued : `${clip.progress}%`}
      </span>
    </Link>
  )
}
