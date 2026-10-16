import { Download, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDeleteClip, useRetryClip } from '@/api/queries'
import MapEmblem from '@/components/MapEmblem'
import StatusChip from '@/components/StatusChip'
import ViewfinderFrame from '@/components/ViewfinderFrame'
import { Button, buttonVariants } from '@/components/ui/button'
import { useLocale, useT } from '@/i18n'
import { clipFailureText, clipLabel, formatBytes, frameLabel, qualityMark, roundMark } from '@/lib/clips'
import { errorMessage } from '@/lib/errorMessage'
import { formatDate } from '@/lib/formatDate'
import { formatDuration } from '@/lib/highlightLabels'
import { nextPossible } from '@/lib/limits'
import { mapLabel } from '@/lib/mapTint'
import { cn } from '@/lib/utils'
import { useViewer } from '@/lib/viewer'
import type { ApiError } from '@/api/client'
import type { ClipResponse } from '@/api/types'

/**
 * What the middle of the frame says: a play mark on a finished clip, the percentage of a recording, else the state. In
 * the small picture of a phone's row only the play mark and the percentage stay, smaller: the row's state line says
 * the rest.
 */
function FrameCenter({ clip }: { clip: ClipResponse }) {
  const t = useT()
  if (clip.status === 'DONE') {
    return (
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-primary max-md:size-7">
        <svg viewBox="0 0 12 12" className="size-4 fill-primary-foreground max-md:size-3">
          <path d="M3.5 1.5v9l7-4.5z" />
        </svg>
      </span>
    )
  }
  if (clip.status === 'RECORDING') {
    // The status line under the frame says the same in words; here the number is the picture.
    return (
      <span
        aria-hidden="true"
        className="font-mono text-[28px] leading-9 font-semibold tabular-nums max-md:text-[13px] max-md:leading-4"
      >
        {clip.progress}%
      </span>
    )
  }
  // A box of 24px with the word of the state alone, as the design draws it: the place in the queue and the reason of a
  // failure are said by the line under the frame. A failure has its box and word in red, any other state in the text
  // colour.
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-6 items-center border bg-background/80 px-2.5 font-mono text-[11px] tracking-[0.08em] whitespace-nowrap uppercase max-md:hidden',
        clip.status === 'FAILED' ? 'border-negative text-negative' : 'border-ring text-foreground',
      )}
    >
      {t.clip.status[clip.status]}
    </span>
  )
}

/** Where an owner's button stands in a phone's row: a 44px square at the right end, beside the row's text. */
const ROW_BUTTON =
  'max-md:col-start-3 max-md:row-span-2 max-md:row-start-1 max-md:ml-0 max-md:size-11 max-md:self-center max-md:px-0'

/**
 * What the owner of a clip can do on its card, as buttons at the end of the state line (positioned, so that they are
 * above the card's link, which is stretched over everything else): take back an order that still
 * waits ("Cancel", after a second click that confirms it), order a failed clip again, download a finished one. They
 * are siblings of the card's link in its box, never inside it. What went wrong is said under the line. The same
 * requests as on the clip's own page, without the admin key: the card is of the signed-in visitor's own.
 *
 * On a phone the state line is no box of its own (`contents`): the button is a 44px icon at the right end of the row,
 * beside the link, and the question "Cancel the order?" and the message take the row's whole width under it.
 */
function ClipActions({ clip, label }: { clip: ClipResponse; label: string }) {
  const t = useT()
  const remove = useDeleteClip()
  const retry = useRetryClip()
  const { limits } = useViewer()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ApiError | null>(null)
  const busy = remove.isPending || retry.isPending
  // "Cancel" comes back when the visitor answers "No": the focus returns to it, not to the page's start.
  const cancelButton = useRef<HTMLButtonElement>(null)
  const refocusCancel = useRef(false)
  useEffect(() => {
    if (!confirming && refocusCancel.current) {
      refocusCancel.current = false
      cancelButton.current?.focus()
    }
  }, [confirming])
  // A new order counts against the day's limit, so a used-up limit turns "Try again" off and the line says why.
  const limitText =
    clip.status === 'FAILED' && limits !== null && limits.clipOrders.remaining <= 0
      ? t.limits.CLIP_LIMIT_REACHED(nextPossible(limits.clipOrders.resetsAt, t))
      : null
  const failed = (error: ApiError) => {
    setConfirming(false)
    setFailure(error)
  }

  const buttons =
    clip.status === 'QUEUED' ? (
      confirming ? (
        <span
          role="group"
          aria-label={t.clip.card.confirmCancel}
          className="relative ml-auto flex items-center gap-1 max-md:col-span-full max-md:row-start-3 max-md:ml-0 max-md:justify-end"
        >
          <span className="mr-1 text-[13px]">{t.clip.card.confirmCancel}</span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => {
              setFailure(null)
              remove.mutate({ clip }, { onError: failed })
            }}
          >
            {t.clip.card.confirmYes}
          </Button>
          <Button type="button" variant="ghost" size="sm" autoFocus
            disabled={busy}
            onClick={() => {
              refocusCancel.current = true
              setConfirming(false)
            }}
          >
            {t.clip.card.keep}
          </Button>
        </span>
      ) : (
        <Button
          ref={cancelButton}
          type="button"
          variant="outline"
          size="sm"
          aria-label={t.clip.card.cancelFor(label)}
          className={cn('relative ml-auto', ROW_BUTTON)}
          onClick={() => setConfirming(true)}
        >
          <X aria-hidden="true" className="hidden max-md:block max-md:size-4" />
          <span className="max-md:sr-only">{t.clip.card.cancel}</span>
        </Button>
      )
    ) : clip.status === 'FAILED' ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t.clip.card.retryFor(label)}
        disabled={busy || limitText !== null}
        // Focusable while it is off: a `disabled` button lets the pointer through to the card's link, and a click on it
        // would open the clip's page.
        focusableWhenDisabled
        className={cn(
          'relative ml-auto data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-transparent',
          ROW_BUTTON,
        )}
        onClick={() => {
          if (busy || limitText !== null) {
            return
          }
          setFailure(null)
          retry.mutate({ clip }, { onError: failed })
        }}
      >
        <RotateCcw aria-hidden="true" />
        <span className="max-md:sr-only">{t.clip.retry}</span>
      </Button>
    ) : clip.status === 'DONE' && clip.videoUrl !== null ? (
      <a
        href={`${clip.videoUrl}?download=1`}
        download
        aria-label={t.clip.card.downloadFor(label)}
        title={t.clip.page.download}
        className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'relative ml-auto', ROW_BUTTON)}
      >
        <Download aria-hidden="true" />
      </a>
    ) : null

  return (
    <>
      {buttons}
      {/* Under the state line, whatever the line holds: always in the page, so that its first message is announced. */}
      <p
        aria-live="polite"
        className={cn(
          'basis-full text-xs leading-normal empty:hidden max-md:col-span-full max-md:row-start-4',
          failure ? 'text-negative' : 'text-muted-foreground',
        )}
      >
        {failure ? (failure.status === 401 ? t.auth.sessionEnded : errorMessage(failure, t)) : limitText}
      </p>
    </>
  )
}

/**
 * One clip as a card (spec 3): the frame with where the clip is from, how long it is and in what quality, then what it
 * shows, whose it is, and its state. The whole card is the link to the clip's page, in whatever state the clip is: the
 * link is the title, stretched over the card, so that the owner's buttons can stand in the card without being in the
 * link (a button in a link is two interactive elements in one).
 *
 * Under `md` the same elements are a row of a list (phone spec 5.2), still a link as a whole: the frame is a 112×64
 * picture at the left with only its brackets and the play mark or the percentage (the corner labels are left out),
 * and beside it the title, the round with the quality (`R9 · 1080p120`) and the state, in mono 10px and in the colour of
 * the state. The owner's button is a 44px icon at the right end.
 */
export default function ClipCard({ clip }: { clip: ClipResponse }) {
  const t = useT()
  const locale = useLocale()
  const viewer = useViewer()
  const recording = clip.status === 'RECORDING'
  const failure = clip.status === 'FAILED' ? clipFailureText(clip, t) : null
  const label = `${clipLabel(clip, t)} · ${clip.nickname}`
  const manage = viewer.canManageClip(clip).allowed
  return (
    <article className="relative flex h-full flex-col border border-border bg-card -outline-offset-2 hover:bg-secondary has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-ring max-md:border-x-0 max-md:border-t-0 max-md:bg-transparent">
      <div className="flex h-full flex-col max-md:grid max-md:min-h-[85px] max-md:grid-cols-[112px_minmax(0,1fr)_auto] max-md:content-center max-md:gap-x-3 max-md:gap-y-0.5 max-md:py-2.5">
        {/* On a phone, the picture at the left of the row, beside the title and the state line (the two rows it spans,
            which grow to its height together). A corner label is wrapped in a span of its own that a phone leaves out:
            the frame draws the label's box, and an empty box is not seen. */}
        <div className="relative max-md:col-start-1 max-md:row-span-2 max-md:row-start-1 max-md:h-16 max-md:w-28 max-md:self-center">
          <ViewfinderFrame
            mapName={clip.mapName}
            imageUrl={clip.thumbnailUrl}
            topLeft={<span className="max-md:hidden">{frameLabel(clip, t)}</span>}
            topRight={
              recording && (
                <span aria-hidden="true" className="flex items-center gap-1.5 max-md:hidden">
                  <span className="size-1.5 animate-rec rounded-full bg-rec" />
                  REC
                </span>
              )
            }
            center={<FrameCenter clip={clip} />}
            bottomLeft={
              clip.durationMs !== null && (
                <span className="max-md:hidden">{formatDuration(clip.durationMs / 1000)}</span>
              )
            }
            bottomRight={<span className="max-md:hidden">{qualityMark(clip)}</span>}
            className="max-md:aspect-auto max-md:size-full"
          />
          {recording && (
            <span
              aria-hidden="true"
              className="absolute bottom-0 left-0 h-0.75 bg-rec"
              style={{ width: `${clip.progress}%` }}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1 px-4 pt-3.5 pb-1.5 max-md:col-start-2 max-md:row-start-1 max-md:gap-0.5 max-md:self-end max-md:p-0">
          <h3 className="truncate text-[15px] font-semibold max-md:text-sm">
            <Link
              to={`/clips/${clip.id}`}
              data-card-link
              className="outline-hidden after:absolute after:inset-0 after:content-['']"
            >
              {label}
            </Link>
          </h3>
          {/* On a phone the line under the title is the round and the quality, as the frame's corners say them. */}
          <p className="font-mono text-[10px] tracking-[0.06em] text-subtle md:hidden">
            {`${roundMark(clip)} · ${qualityMark(clip)}`}
          </p>
          <p className="truncate text-[13px] text-muted-foreground max-md:hidden">
            {/* In the line of text, 16px, as a letter would be: the emblem is the first thing of the line, so it is
                cut with the rest when the line is too long. */}
            <MapEmblem
              mapName={clip.mapName}
              size={16}
              fallback="none"
              className="mr-1.5 inline-block align-[-3px]"
            />
            {mapLabel(clip.mapName) ?? t.match.unknownMap}
            {clip.roundNumber !== null && `, ${t.highlight.round(clip.roundNumber)}`}
            {' · '}
            <time dateTime={clip.createdAt}>{formatDate(clip.createdAt, locale)}</time>
          </p>
        </div>
        {/* 44px of line and 6px under it, as the design's card has. On a phone the line is no box of its own: the
            state is the third line beside the picture, the owner's button the right end of the row. */}
        <div className="mt-auto flex min-h-12.5 min-w-0 flex-wrap items-center gap-x-2 px-4 pb-1.5 max-md:contents">
          {/* The words of the state: a box of their own on a phone only (from `md` they are the line's own items). */}
          <span className="contents max-md:col-start-2 max-md:row-start-2 max-md:flex max-md:min-w-0 max-md:items-center max-md:gap-x-2 max-md:self-start">
            {/* The frame above has the blinking dot and the large percentage of a recording; the line says the word,
                and the number stays there for a screen reader, who does not see the frame (not announced: it changes
                with every answer of the backend). */}
            <StatusChip
              clip={clip}
              percent={false}
              dot={false}
              className={cn('max-md:text-[10px] max-md:leading-[15px]', recording && 'max-md:text-rec')}
            />
            {recording && (
              <span aria-live="off" className="sr-only">
                {clip.progress}%
              </span>
            )}
            {clip.status === 'DONE' && clip.sizeBytes !== null && (
              <span className="font-mono text-[11px] tracking-[0.06em] text-subtle max-md:text-[10px]">
                {formatBytes(clip.sizeBytes)}
              </span>
            )}
            {/* Why it failed: in the visitor's language when the backend gave the reason a code, else the recorder's
                own words, as they are. */}
            {failure && (
              <span className="min-w-0 truncate font-mono text-[11px] tracking-[0.06em] text-subtle max-md:text-[10px]">
                {failure}
              </span>
            )}
          </span>
          {manage && <ClipActions clip={clip} label={label} />}
        </div>
      </div>
    </article>
  )
}
