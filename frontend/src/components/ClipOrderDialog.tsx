import { X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useOrderMontage, useRecorderStatus, useRequestCompilation, useRequestHighlightClip } from '@/api/queries'
import KillTimeline from '@/components/KillTimeline'
import RecDot from '@/components/RecDot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import { setAdminKey, useAdminKey } from '@/lib/adminKey'
import { CLIP_QUALITIES } from '@/lib/clips'
import { denialText, errorMessage } from '@/lib/errorMessage'
import { describeHighlight, formatDuration, highlightLabel } from '@/lib/highlightLabels'
import { nextPossible } from '@/lib/limits'
import { mapLabel } from '@/lib/mapTint'
import { cn } from '@/lib/utils'
import { useViewer } from '@/lib/viewer'
import type { ApiError } from '@/api/client'
import type { MontageRequest } from '@/api/editorTypes'
import type { ClipQuality, ClipResponse, HighlightResponse } from '@/api/types'

/**
 * What can be ordered: the clip of one highlight, one video of every kill of a player in a match, or a montage that the
 * player put together in the editor (its quality is chosen there, so the dialog only names it). `durationSeconds` and
 * `musicName` are what the editor worked out, for the summary.
 */
export type ClipOrder =
  | { kind: 'highlight'; highlight: HighlightResponse }
  | { kind: 'compilation'; matchId: string; mapName: string | null; playerId: string; nickname: string }
  | {
      kind: 'montage'
      matchId: string
      mapName: string | null
      playerId: string
      nickname: string
      request: MontageRequest
      durationSeconds: number
      musicName: string | null
    }

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

/** What is about to be recorded when it is a montage: whose, of which match, its title and what it is made of. */
function MontageSummary({ order }: { order: Extract<ClipOrder, { kind: 'montage' }> }) {
  const t = useT()
  const map = mapLabel(order.mapName)
  const { request } = order
  const facts = [
    t.montage.order.segments(request.segments.length),
    formatDuration(order.durationSeconds),
    request.quality,
    request.aspect,
    request.intro ? t.montage.order.intro : null,
    order.musicName,
  ].filter((fact): fact is string => fact !== null)
  return (
    <div className="flex flex-col gap-3 border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Badge variant="outline">{t.montage.kind}</Badge>
        <span className="min-w-0 truncate text-[15px] font-semibold">{order.nickname}</span>
        {map && <span className="label-mono">{map}</span>}
      </div>
      {request.title && <p className="text-[15px] break-words">«{request.title}»</p>}
      <p className="font-mono text-xs text-muted-foreground">{facts.join(' · ')}</p>
    </div>
  )
}

/** Who the order is for: the player whose kills it records. */
function orderedPlayer(order: ClipOrder): string {
  return order.kind === 'highlight' ? order.highlight.playerId : order.playerId
}

interface OrderFormProps {
  order: ClipOrder
  /** A request of this form is on its way. The dialog holds the flag, because it must not close meanwhile. */
  sending: boolean
  onSendingChange: (sending: boolean) => void
  onClose: () => void
  /** Called with the clip the backend put in the queue, before the dialog closes. */
  onOrdered?: (clip: ClipResponse) => void
}

/**
 * The order itself. It is mounted when the dialog opens, so every opening starts from the defaults.
 *
 * Who may order, as in the demo panel: the signed-in player whose highlight (or kills) it is, and an administrator,
 * by the session alone, with no key field; anybody with the admin key. The player is told how many orders of the day
 * are left, and at none the button is off and the form says from when the next is possible. A signed-in visitor who
 * may not order reads why; the key field is then behind the quiet switch. A visitor who is not signed in is shown the
 * field: a key the backend took is kept until the page is reloaded, and a key it rejects is forgotten.
 */
function OrderForm({ order, sending, onSendingChange, onClose, onOrdered }: OrderFormProps) {
  const t = useT()
  const keyId = useId()
  const messagesId = useId()
  // The higher quality is the recommended one (spec 4); a montage brings the one chosen in the editor.
  const [chosenQuality, setQuality] = useState<ClipQuality>('1080p')
  const quality = order.kind === 'montage' ? order.request.quality : chosenQuality
  const [typedKey, setTypedKey] = useState('')
  const [keyRejected, setKeyRejected] = useState(false)
  // The backend refused an order made by the session alone as nobody's: the session has ended since the page asked.
  const [sessionEnded, setSessionEnded] = useState(false)
  // A signed-in visitor opened the key field (an operator's way in where the session is not enough).
  const [keyOpen, setKeyOpen] = useState(false)
  const [failure, setFailure] = useState<ApiError | null>(null)
  const viewer = useViewer()
  const permission = viewer.canOrderFor(orderedPlayer(order))
  const storedKey = useAdminKey()
  // Not until it is known who is signed in: see the demo panel.
  const keyField = storedKey === null && !viewer.loading && (!viewer.signedIn || keyOpen)
  // The key that goes with the order, if any: see the demo panel.
  const apiKey = storedKey ?? (keyField ? typedKey.trim() : '')
  const withKey = apiKey.length > 0
  const denial = denialText(permission.reason, t)
  // The day's limit counts only the orders a player makes by the session; null when there is none to name.
  const limit = permission.allowed && !withKey ? (viewer.limits?.clipOrders ?? null) : null
  const noneLeft = limit !== null && limit.remaining <= 0
  const recorder = useRecorderStatus()
  const highlightClip = useRequestHighlightClip()
  const compilation = useRequestCompilation()
  const montage = useOrderMontage()
  const hints: Record<ClipQuality, string> = { '720p': t.clip.order.fasterSmaller, '1080p': t.clip.order.recommended }

  // A form that goes away takes its flag with it, whatever became of its request.
  useEffect(() => () => onSendingChange(false), [onSendingChange])

  function start() {
    // The key this order goes out with, if any: what its answer says is about that key.
    const sentKey = withKey ? apiKey : null
    setKeyRejected(false)
    setSessionEnded(false)
    setFailure(null)
    // Set with the click itself and not read from the state of the request, which follows a moment later: the dialog
    // has to refuse to close from the very next key press on.
    onSendingChange(true)
    const callbacks = {
      onSuccess: (clip: ClipResponse) => {
        onSendingChange(false)
        if (sentKey !== null) {
          // The backend took the key, so it is the right one: keep it for the next clip.
          setAdminKey(sentKey)
        }
        onOrdered?.(clip)
        onClose()
      },
      onError: (error: ApiError) => {
        onSendingChange(false)
        if (error.status === 401 && sentKey === null) {
          // No key went out, so it is the session that has ended, not a key that is wrong.
          setSessionEnded(true)
        } else if (error.status === 401) {
          // A rejected key is forgotten everywhere: the stored one, the one in the field and the one the rejected
          // request keeps in its variables.
          setAdminKey(null)
          setTypedKey('')
          setKeyRejected(true)
          highlightClip.reset()
          compilation.reset()
          montage.reset()
        } else {
          setFailure(error)
        }
      },
    }
    if (order.kind === 'highlight') {
      highlightClip.mutate({ apiKey: sentKey ?? undefined, highlightId: order.highlight.id, quality }, callbacks)
    } else if (order.kind === 'montage') {
      montage.mutate({ apiKey: sentKey ?? undefined, matchId: order.matchId, request: order.request }, callbacks)
    } else {
      compilation.mutate(
        { apiKey: sentKey ?? undefined, matchId: order.matchId, playerId: order.playerId, quality },
        callbacks,
      )
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
      {order.kind === 'highlight' && <HighlightSummary highlight={order.highlight} />}
      {order.kind === 'compilation' && <CompilationSummary order={order} />}
      {order.kind === 'montage' && <MontageSummary order={order} />}
      {/* A montage's quality was chosen in the editor, and its summary names it. */}
      {order.kind !== 'montage' && (
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
      )}
      {/* Until it is known who is signed in, the room of the key field, so that it does not arrive with a jump. */}
      {viewer.loading && storedKey === null && <div aria-hidden="true" className="h-16" />}
      {/* Why not, before the key field: a signed-in visitor is never left with a bare key field. */}
      {denial !== null && <p className="text-sm leading-normal text-muted-foreground">{denial}</p>}
      {keyField && (
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
          {!viewer.signedIn && <p className="text-[13px] text-muted-foreground">{t.clip.order.needsKey}</p>}
        </div>
      )}
      {(recorder.data || limit !== null) && (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-t border-border pt-4 text-sm">
          {recorder.data && (
            <>
              <dt className="text-muted-foreground">{t.clip.order.queue}</dt>
              <dd className="text-right">{t.clip.order.queueAhead(recorder.data.queued + recorder.data.active)}</dd>
              {!recorder.data.online && (
                <dd className="col-span-2 text-[13px] text-muted-foreground">{t.clip.order.recorderOffline}</dd>
              )}
            </>
          )}
          {limit !== null && (
            <>
              <dt className="text-muted-foreground">{t.clip.order.orders}</dt>
              <dd className="text-right">{t.clip.order.ordersLeft(Math.max(0, limit.remaining), limit.limit)}</dd>
            </>
          )}
        </dl>
      )}
      {/* Always in the dialog, so that its first message is announced; while empty it takes back the gap above. */}
      <div id={messagesId} aria-live="polite" className="text-sm empty:-mt-5.5">
        {sending && <p className="text-muted-foreground">{t.demo.sending}</p>}
        {keyRejected && <p className="text-destructive">{t.demo.wrongKey}</p>}
        {sessionEnded && <p className="text-destructive">{t.auth.sessionEnded}</p>}
        {failure && <p className="text-destructive">{errorMessage(failure, t)}</p>}
        {/* Not a failure: the button is off, and this is why and until when. */}
        {noneLeft && !sending && !failure && (
          <p className="text-foreground">{t.clip.order.noneLeft(nextPossible(limit.resetsAt, t))}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {/* The operator's way in for a signed-in visitor, at the far end of the row from the two buttons; on a phone it
            has a row of its own above them. */}
        {viewer.signedIn && !viewer.admin && storedKey === null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={keyOpen}
            className="mr-auto -ml-3.5 font-normal text-muted-foreground max-sm:basis-full max-sm:justify-start"
            onClick={() => setKeyOpen(!keyOpen)}
          >
            {t.access.useAdminKey}
          </Button>
        )}
        <Button type="button" variant="outline" disabled={sending} onClick={onClose}>
          {t.clip.order.cancel}
        </Button>
        <Button type="submit" disabled={sending || noneLeft || !(permission.allowed || withKey)}>
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
  /** Called with the clip that was put in the queue (the montage editor then opens its page). */
  onOrdered?: (clip: ClipResponse) => void
}

/**
 * The order of a clip (spec 4): what will be recorded, the quality to choose, how long the queue is, and the button
 * that puts the clip in the queue. The price and the Telegram switch of the mockup come with later plans.
 *
 * While the request is on its way the dialog cannot be closed, by its buttons, by Escape or by a click outside: the
 * request cannot be taken back, and what the backend says to it (the key is wrong, the queue is full) is shown here.
 */
export default function ClipOrderDialog({ order, onClose, onOrdered }: ClipOrderDialogProps) {
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
          <DialogTitle>{order?.kind === 'montage' ? t.montage.order.title : t.clip.order.title}</DialogTitle>
          <DialogClose
            disabled={sending}
            render={<Button type="button" variant="ghost" size="icon" className="-my-2 -mr-3 text-muted-foreground" />}
            aria-label={t.clip.order.close}
          >
            <X aria-hidden="true" />
          </DialogClose>
        </div>
        {order && (
          <OrderForm
            order={order}
            sending={sending}
            onSendingChange={setSending}
            onClose={onClose}
            onOrdered={onOrdered}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
