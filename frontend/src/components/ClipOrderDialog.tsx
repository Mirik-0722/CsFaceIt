import { X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useRecorderStatus, useRequestCompilation, useRequestHighlightClip } from '@/api/queries'
import KillTimeline from '@/components/KillTimeline'
import RecDot from '@/components/RecDot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import { setAdminKey, useAdminKey } from '@/lib/adminKey'
import { CLIP_QUALITIES } from '@/lib/clips'
import { errorMessage } from '@/lib/errorMessage'
import { describeHighlight, formatDuration, highlightLabel } from '@/lib/highlightLabels'
import { mapLabel } from '@/lib/mapTint'
import { cn } from '@/lib/utils'
import type { ApiError } from '@/api/client'
import type { ClipQuality, HighlightResponse } from '@/api/types'

/** What can be ordered: the clip of one highlight, or one video of every kill of a player in a match. */
export type ClipOrder =
  | { kind: 'highlight'; highlight: HighlightResponse }
  | { kind: 'compilation'; matchId: string; mapName: string | null; playerId: string; nickname: string }

// A side is shown as its letters in its own colour, so the colour is never the only sign.
const SIDE_CLASS: Record<string, string> = { CT: 'text-side-ct', T: 'text-side-t' }

/** What is about to be recorded: the highlight as its card shows it, in one panel. */
function HighlightSummary({ highlight }: { highlight: HighlightResponse }) {
  const t = useT()
  const map = mapLabel(highlight.mapName)
  const sideClass = highlight.side ? SIDE_CLASS[highlight.side] : undefined
  return (
    <div className="flex flex-col gap-3 border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Badge variant={highlight.type === 'ACE' ? 'default' : 'outline'} className="normal-case">
          {highlightLabel(highlight.type, t)}
        </Badge>
        <span className="min-w-0 truncate text-[15px] font-semibold">{highlight.nickname}</span>
        <span className="label-mono">
          {map && `${map} · `}
          {t.highlight.round(highlight.roundNumber)}
          {sideClass && (
            <>
              {' · '}
              <span className={sideClass}>{highlight.side}</span>
            </>
          )}
        </span>
        <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
          <span className="sr-only">{t.highlight.duration}</span> {formatDuration(highlight.durationSeconds)}
        </span>
      </div>
      <KillTimeline
        start={highlight.roundStartTick}
        end={highlight.roundEndTick}
        windowStart={highlight.tickStart}
        windowEnd={highlight.tickEnd}
        marks={highlight.kills.map((kill) => kill.tick)}
      />
      <p className="text-[13px] text-muted-foreground">{describeHighlight(highlight, t)}</p>
    </div>
  )
}

/** What is about to be recorded when it is a compilation: whose kills, and of which match. */
function CompilationSummary({ order }: { order: Extract<ClipOrder, { kind: 'compilation' }> }) {
  const t = useT()
  const map = mapLabel(order.mapName)
  return (
    <div className="flex flex-col gap-3 border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Badge variant="outline">{t.clip.compilation}</Badge>
        <span className="min-w-0 truncate text-[15px] font-semibold">{order.nickname}</span>
        {map && <span className="label-mono">{map}</span>}
      </div>
      <p className="text-[13px] text-muted-foreground">{t.clip.compilationPanel.allKills}</p>
    </div>
  )
}

interface OrderFormProps {
  order: ClipOrder
  /** A request of this form is on its way. The dialog holds the flag, because it must not close meanwhile. */
  sending: boolean
  onSendingChange: (sending: boolean) => void
  onClose: () => void
}

/**
 * The order itself. It is mounted when the dialog opens, so every opening starts from the defaults. The admin key is
 * asked for here when the page does not hold one yet, as in the demo panel: a key the backend took is kept until the
 * page is reloaded, and a key it rejects is forgotten.
 */
function OrderForm({ order, sending, onSendingChange, onClose }: OrderFormProps) {
  const t = useT()
  const keyId = useId()
  const messagesId = useId()
  // The higher quality is the recommended one (spec 4).
  const [quality, setQuality] = useState<ClipQuality>('1080p')
  const [typedKey, setTypedKey] = useState('')
  const [keyRejected, setKeyRejected] = useState(false)
  const [failure, setFailure] = useState<ApiError | null>(null)
  const storedKey = useAdminKey()
  const apiKey = storedKey ?? typedKey.trim()
  const recorder = useRecorderStatus()
  const highlightClip = useRequestHighlightClip()
  const compilation = useRequestCompilation()
  const hints: Record<ClipQuality, string> = { '720p': t.clip.order.fasterSmaller, '1080p': t.clip.order.recommended }

  // A form that goes away takes its flag with it, whatever became of its request.
  useEffect(() => () => onSendingChange(false), [onSendingChange])

  function start() {
    setKeyRejected(false)
    setFailure(null)
    // Set with the click itself and not read from the state of the request, which follows a moment later: the dialog
    // has to refuse to close from the very next key press on.
    onSendingChange(true)
    const callbacks = {
      onSuccess: () => {
        onSendingChange(false)
        // The backend took the key, so it is the right one: keep it for the next clip.
        setAdminKey(apiKey)
        onClose()
      },
      onError: (error: ApiError) => {
        onSendingChange(false)
        if (error.status === 401) {
          // A rejected key is forgotten everywhere: the stored one, the one in the field and the one the rejected
          // request keeps in its variables.
          setAdminKey(null)
          setTypedKey('')
          setKeyRejected(true)
          highlightClip.reset()
          compilation.reset()
        } else {
          setFailure(error)
        }
      },
    }
    if (order.kind === 'highlight') {
      highlightClip.mutate({ apiKey, highlightId: order.highlight.id, quality }, callbacks)
    } else {
      compilation.mutate({ apiKey, matchId: order.matchId, playerId: order.playerId, quality }, callbacks)
    }
  }

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        start()
      }}
    >
      {order.kind === 'highlight' ? (
        <HighlightSummary highlight={order.highlight} />
      ) : (
        <CompilationSummary order={order} />
      )}
      <fieldset className="min-w-0">
        <legend className="label-mono">{t.clip.order.quality}</legend>
        <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
          {CLIP_QUALITIES.map((option) => (
            // The whole box is the label of its radio button; the chosen one has the light outline.
            <label
              key={option}
              className={cn(
                'flex min-h-17 cursor-pointer items-start gap-3 border p-3.5',
                quality === option ? 'border-foreground' : 'border-line-strong',
              )}
            >
              <input
                type="radio"
                name="quality"
                value={option}
                checked={quality === option}
                onChange={() => setQuality(option)}
                className="mt-0.75 size-4 shrink-0 accent-foreground"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-mono text-sm font-semibold">{option}</span>
                <span className="text-[13px] text-muted-foreground">{hints[option]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {storedKey === null && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={keyId} className="label-mono">
            {t.demo.adminKey}
          </label>
          <Input
            id={keyId}
            type="password"
            autoComplete="new-password"
            value={typedKey}
            onChange={(event) => setTypedKey(event.target.value)}
            aria-invalid={keyRejected ? true : undefined}
            aria-describedby={messagesId}
          />
          <p className="text-[13px] text-muted-foreground">{t.clip.order.adminOnly}</p>
        </div>
      )}
      {recorder.data && (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-t border-border pt-4 text-sm">
          <dt className="text-muted-foreground">{t.clip.order.queue}</dt>
          <dd className="text-right">{t.clip.order.queueAhead(recorder.data.queued + recorder.data.active)}</dd>
          {!recorder.data.online && (
            <dd className="col-span-2 text-[13px] text-muted-foreground">{t.clip.order.recorderOffline}</dd>
          )}
        </dl>
      )}
      {/* Always in the dialog, so that its first message is announced; while empty it takes back the gap above. */}
      <div id={messagesId} aria-live="polite" className="text-sm empty:-mt-5.5">
        {sending && <p className="text-muted-foreground">{t.demo.sending}</p>}
        {keyRejected && <p className="text-destructive">{t.demo.wrongKey}</p>}
        {failure && <p className="text-destructive">{errorMessage(failure, t)}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="outline" disabled={sending} onClick={onClose}>
          {t.clip.order.cancel}
        </Button>
        <Button type="submit" disabled={sending || apiKey.length === 0}>
          <RecDot />
          {t.clip.order.start}
        </Button>
      </div>
    </form>
  )
}

interface ClipOrderDialogProps {
  /** What to record; the dialog is open while there is something. */
  order: ClipOrder | null
  onClose: () => void
}

/**
 * The order of a clip (spec 4): what will be recorded, the quality to choose, how long the queue is, and the button
 * that puts the clip in the queue. The price and the Telegram switch of the mockup come with later plans.
 *
 * While the request is on its way the dialog cannot be closed, by its buttons, by Escape or by a click outside: the
 * request cannot be taken back, and what the backend says to it (the key is wrong, the queue is full) is shown here.
 */
export default function ClipOrderDialog({ order, onClose }: ClipOrderDialogProps) {
  const t = useT()
  const [sending, setSending] = useState(false)
  return (
    <Dialog
      open={order !== null}
      onOpenChange={(next, details) => {
        if (next) {
          return
        }
        if (sending) {
          // Refused, and said to the dialog as well: it would otherwise close by itself.
          details.cancel()
          return
        }
        onClose()
      }}
    >
      <DialogContent>
        <div className="flex items-center justify-between gap-3">
          <DialogTitle>{t.clip.order.title}</DialogTitle>
          <DialogClose
            disabled={sending}
            render={<Button type="button" variant="ghost" size="icon" className="-my-2 -mr-3 text-muted-foreground" />}
            aria-label={t.clip.order.close}
          >
            <X aria-hidden="true" />
          </DialogClose>
        </div>
        {order && <OrderForm order={order} sending={sending} onSendingChange={setSending} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}
