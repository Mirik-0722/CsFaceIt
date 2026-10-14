import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEditorSource } from '@/api/editor'
import type { EditorSource } from '@/api/editorTypes'
import ClipOrderDialog, { type ClipOrder } from '@/components/ClipOrderDialog'
import MapEmblem from '@/components/MapEmblem'
import RecDot from '@/components/RecDot'
import SignInDialog from '@/components/SignInDialog'
import KillLibrary from '@/components/montage/KillLibrary'
import MontageInspector from '@/components/montage/MontageInspector'
import MontageMonitor from '@/components/montage/MontageMonitor'
import MontageTimeline from '@/components/montage/MontageTimeline'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { useAdminKey } from '@/lib/adminKey'
import { denialText, errorMessage } from '@/lib/errorMessage'
import { formatDuration } from '@/lib/highlightLabels'
import { mapLabel } from '@/lib/mapTint'
import {
  type LibraryKill,
  type Montage,
  type MontageOptions,
  type Problem,
  type Segment,
  addKills,
  allKills,
  draftKey,
  emptyMontage,
  layoutOf,
  moveSegment,
  parseDraft,
  problemsOf,
  serializeDraft,
  toRequest,
} from '@/lib/montage'
import { cn } from '@/lib/utils'
import { useViewer } from '@/lib/viewer'

/** The page's own width: wider than the site's column, since the editor is a workbench (spec 8, the editor's rulings). */
const PAGE = 'mx-auto w-full max-w-[1680px] px-[clamp(16px,4vw,40px)]'

/** The draft the browser keeps, if it can be read at all. */
function readDraft(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Whether the montage is the one the editor starts with: then there is nothing to keep. */
function isEmpty(montage: Montage, source: EditorSource): boolean {
  return montage.segments.length === 0 && serializeDraft(montage) === serializeDraft(emptyMontage(source))
}

type DraftState = 'saved' | 'saving' | 'notSaved'

/**
 * Keeps the montage in the browser 400 ms after its last change (spec 4, "Qoralama"): an empty montage is no draft, so
 * its key is removed. A change still waiting when the editor goes away is written then.
 */
function useDraft(key: string, montage: Montage, source: EditorSource): DraftState {
  const [state, setState] = useState<DraftState>('saved')
  const first = useRef(true)
  const pending = useRef<Montage | null>(null)
  const write = useCallback(
    (value: Montage): DraftState => {
      try {
        if (isEmpty(value, source)) {
          localStorage.removeItem(key)
        } else {
          localStorage.setItem(key, serializeDraft(value))
        }
        return 'saved'
      } catch {
        return 'notSaved'
      }
    },
    [key, source],
  )
  useEffect(() => {
    // The montage the page opened with is the draft as it is.
    if (first.current) {
      first.current = false
      return
    }
    pending.current = montage
    setState('saving')
    const timer = window.setTimeout(() => {
      pending.current = null
      setState(write(montage))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [montage, write])
  useEffect(() => {
    const flush = () => {
      if (pending.current) {
        write(pending.current)
        pending.current = null
      }
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [write])
  return state
}

/**
 * The playhead and the playing of the montage: real time, by animation frames, from where the playhead is to the end,
 * where it stops. It never starts by itself.
 */
function usePlayhead(total: number) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timeRef = useRef(0)
  const seek = useCallback((next: number) => {
    timeRef.current = next
    setTime(next)
  }, [])
  useEffect(() => {
    if (!playing) {
      return
    }
    let last = performance.now()
    let frame = 0
    const step = (now: number) => {
      const next = Math.min(timeRef.current + (now - last) / 1000, total)
      last = now
      timeRef.current = next
      setTime(next)
      if (next >= total) {
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, total])
  const toggle = useCallback(() => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (total <= 0) {
      return
    }
    // At the end, play starts again from the beginning.
    if (timeRef.current >= total - 0.05) {
      seek(0)
    }
    setPlaying(true)
  }, [playing, total, seek])
  return { time: Math.min(time, total), playing, seek, toggle, stop: () => setPlaying(false) }
}

/** Whether a key press belongs to the control it is on: Space plays only where it means nothing else. */
function spaceIsTaken(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  if (target.closest('[role="dialog"]')) {
    return true
  }
  return (
    target.closest(
      'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="switch"], [role="checkbox"], [role="radio"]',
    ) !== null
  )
}

function DraftStatus({ state, visible }: { state: DraftState; visible: boolean }) {
  const t = useT()
  return (
    <p
      aria-live="polite"
      className={cn(
        'flex items-center gap-2 font-mono text-[11px] tracking-[0.04em] text-subtle',
        !visible && 'invisible',
        state === 'notSaved' && 'text-negative',
      )}
    >
      {state === 'saved' && <span aria-hidden="true" className="size-1.5 rounded-full bg-positive" />}
      {t.montage.draft[state]}
    </p>
  )
}

/** "Clear", asked twice: the first press turns it into the question and the two answers. */
function ClearButton({ disabled, onClear }: { disabled: boolean; onClear: () => void }) {
  const t = useT()
  const [asking, setAsking] = useState(false)
  const clearRef = useRef<HTMLButtonElement>(null)
  const noRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  useEffect(() => {
    if (asking) {
      noRef.current?.focus()
    } else if (returnFocus.current) {
      returnFocus.current = false
      clearRef.current?.focus()
    }
  }, [asking])
  if (asking) {
    return (
      <div role="group" aria-label={t.montage.confirmClear} className="flex items-center gap-2">
        <span className="text-sm">{t.montage.confirmClear}</span>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => {
            returnFocus.current = true
            onClear()
            setAsking(false)
          }}
        >
          {t.montage.clearYes}
        </Button>
        <Button
          ref={noRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            returnFocus.current = true
            setAsking(false)
          }}
        >
          {t.montage.clearNo}
        </Button>
      </div>
    )
  }
  return (
    <Button ref={clearRef} type="button" variant="outline" disabled={disabled} onClick={() => setAsking(true)}>
      {t.montage.clear}
    </Button>
  )
}

interface OrderActionProps {
  source: EditorSource
  problems: Problem[]
  /** Opens the order; `keyFirst` with the admin key field open. */
  onOrder: (keyFirst: boolean) => void
  onSignIn: () => void
  /** `header`: the full action of a wide page; `bar`: the compact one of the bar at the bottom of a phone. */
  place: 'header' | 'bar'
}

/**
 * The order of the montage, by the compilation's rules (spec 4): the player's own kills for the signed-in player, any
 * player's for an administrator or with the admin key. A visitor who is not signed in is invited to sign in, or to go
 * on with the key; a signed-in visitor in another player's editor reads why not. Until it is known who is signed in the
 * action keeps its room, unseen.
 */
function OrderAction({ source, problems, onOrder, onSignIn, place }: OrderActionProps) {
  const t = useT()
  const viewer = useViewer()
  const adminKey = useAdminKey()
  const known = adminKey !== null || !viewer.loading
  const permission = viewer.canOrderFor(source.player.playerId)
  const blocked = problems.length > 0
  const compact = place === 'bar'
  if (!known) {
    return (
      <Button type="button" disabled aria-hidden="true" className="invisible">
        <RecDot />
        {t.montage.record}
      </Button>
    )
  }
  if (adminKey !== null || permission.allowed) {
    return (
      <Button type="button" disabled={blocked} onClick={() => onOrder(false)}>
        <RecDot />
        {t.montage.record}
      </Button>
    )
  }
  const withKey = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={blocked}
      className="font-normal text-muted-foreground"
      onClick={() => onOrder(viewer.signedIn)}
    >
      {t.access.useAdminKey}
    </Button>
  )
  if (!viewer.signedIn) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        {!compact && <p className="text-sm text-muted-foreground">{t.montage.signInToRecord}</p>}
        {withKey}
        <Button type="button" variant="outline" onClick={onSignIn}>
          {t.montage.signIn}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
      {!compact && <p className="max-w-sm text-sm text-muted-foreground">{denialText(permission.reason, t)}</p>}
      {withKey}
    </div>
  )
}

/** Where the editor would be while its source is on its way: the header and the three panels as outlined boxes. */
function EditorSkeleton() {
  const t = useT()
  return (
    <div className="flex flex-col gap-4">
      <p className="label-mono">{t.montage.loading}</p>
      <Skeleton className="h-20 w-full" />
      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_280px] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <Skeleton className="h-[min(56dvh,40rem)] lg:col-start-2 lg:row-start-1" />
        <Skeleton className="h-[min(56dvh,40rem)] lg:col-start-3 lg:row-start-1" />
        <Skeleton className="h-[min(56dvh,40rem)] lg:col-start-1 lg:row-start-1" />
      </div>
    </div>
  )
}

/** Why the editor cannot open, with the way back to the match. */
function EditorProblem({ matchId, text }: { matchId: string; text: string }) {
  const t = useT()
  return (
    <div className="flex flex-col items-start gap-4 border border-border bg-card p-6">
      <p className="text-[15px]">{text}</p>
      <Link to={`/matches/${encodeURIComponent(matchId)}`} className={buttonVariants({ variant: 'outline' })}>
        {t.montage.errors.backToMatch}
      </Link>
    </div>
  )
}

interface WorkbenchProps {
  matchId: string
  /** The player as the address names them: the draft is kept under it. */
  playerId: string
  source: EditorSource
}

/** The editor itself, once its source is here: the header, the three panels and the order. */
function Workbench({ matchId, playerId, source }: WorkbenchProps) {
  const t = useT()
  const navigate = useNavigate()
  const key = draftKey(matchId, playerId)
  // The montage the editor opens with, and whether a draft was kept that no longer fits the demo: the editor then
  // says so once (until the notice is closed or the montage changes), instead of dropping the draft without a word.
  const [initial] = useState(() => {
    const raw = readDraft(key)
    const parsed = parseDraft(raw, source)
    return { montage: parsed ?? emptyMontage(source), stale: raw !== null && parsed === null }
  })
  const [montage, setMontage] = useState<Montage>(initial.montage)
  const [staleNotice, setStaleNotice] = useState(initial.stale)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [order, setOrder] = useState<ClipOrder | null>(null)
  const [keyFirst, setKeyFirst] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const draft = useDraft(key, montage, source)
  const layout = layoutOf(montage, source.tickRate)
  const { time, playing, seek, toggle, stop } = usePlayhead(layout.total)
  const problems = problemsOf(montage, source)
  const selected = montage.segments.find((segment) => segment.id === selectedId) ?? null
  const kills = allKills(source)

  // Space plays and pauses, unless the focus is where Space means something of its own.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return
      }
      if (spaceIsTaken(event.target)) {
        return
      }
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  /** Selects a segment of `within` (the montage as it is about to be) and puts the playhead at its start. */
  function select(id: number, within: Montage = montage) {
    setSelectedId(id)
    const part = layoutOf(within, source.tickRate).parts.find((candidate) => candidate.segment.id === id)
    if (part) {
      seek(part.from)
    }
  }

  function add(items: LibraryKill[]) {
    const result = addKills(montage.segments, source, items)
    const next = { ...montage, segments: result.segments }
    setMontage(next)
    if (result.landed !== null) {
      select(result.landed, next)
    }
  }

  function replace(segment: Segment) {
    setMontage((current) => ({
      ...current,
      segments: current.segments.map((other) => (other.id === segment.id ? segment : other)),
    }))
  }

  /** Removes a segment; the one after it (or else before it) is selected in its place. */
  function remove(id: number) {
    const index = montage.segments.findIndex((segment) => segment.id === id)
    const neighbour = montage.segments[index + 1] ?? montage.segments[index - 1]
    const next = { ...montage, segments: montage.segments.filter((segment) => segment.id !== id) }
    setMontage(next)
    if (neighbour) {
      select(neighbour.id, next)
    } else {
      setSelectedId(null)
    }
  }

  function move(from: number, to: number) {
    const next = { ...montage, segments: moveSegment(montage.segments, from, to) }
    setMontage(next)
    if (selectedId !== null) {
      select(selectedId, next)
    }
  }

  function moveSelected(by: -1 | 1) {
    const index = montage.segments.findIndex((segment) => segment.id === selectedId)
    if (index >= 0) {
      move(index, index + by)
    }
  }

  function clear() {
    stop()
    setMontage(emptyMontage(source))
    setSelectedId(null)
    seek(0)
    try {
      localStorage.removeItem(key)
    } catch {
      // A browser that keeps nothing has nothing to remove.
    }
  }

  // The starts the transport jumps between: the intro's and every segment's.
  const starts = [...(layout.introEnd > 0 ? [0] : []), ...layout.parts.map((part) => part.from)]
  const previous = [...starts].reverse().find((start) => start < time - 0.25)
  const next = starts.find((start) => start > time + 0.001)

  function openOrder(withKey: boolean) {
    const music = source.limits.musicTracks.find((track) => track.id === montage.options.musicTrack)
    setKeyFirst(withKey)
    setOrder({
      kind: 'montage',
      matchId,
      mapName: source.mapName,
      playerId: source.player.playerId,
      nickname: source.player.nickname,
      request: toRequest(montage, source.player.playerId),
      durationSeconds: layout.total,
      musicName: music?.name ?? null,
    })
  }

  const map = mapLabel(source.mapName)
  const empty = isEmpty(montage, source)
  const orderAction = (place: 'header' | 'bar') => (
    <OrderAction
      source={source}
      problems={problems}
      onOrder={openOrder}
      onSignIn={() => setSigningIn(true)}
      place={place}
    />
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4">
          <MapEmblem mapName={source.mapName} size={44} />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="label-mono">{t.montage.title}</p>
            <h1 className="truncate text-[26px] leading-[1.2] font-semibold tracking-[-0.02em]">
              {source.player.nickname}
            </h1>
            <p className="font-mono text-xs text-subtle uppercase">
              {[map, t.montage.facts(source.rounds.length, kills.length)].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 max-sm:w-full max-sm:justify-between">
          <DraftStatus state={draft} visible={!empty || draft !== 'saved'} />
          <ClearButton disabled={empty} onClear={clear} />
          <div className="max-lg:hidden">{orderAction('header')}</div>
        </div>
      </div>
      {staleNotice && montage === initial.montage && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border border-line-strong bg-card px-4 py-2.5"
        >
          <p className="text-sm">{t.montage.staleDraft}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setStaleNotice(false)
              // The draft that no longer fits is dropped, so the notice does not come back at the next visit.
              try {
                localStorage.removeItem(key)
              } catch {
                // A browser that keeps nothing has nothing to remove.
              }
            }}
          >
            {t.montage.staleDraftOk}
          </Button>
        </div>
      )}
      {/* The panels in the order a phone shows them, which is also the order of Tab and of a screen reader: the monitor
          and the timeline, the inspector, the library. From `lg` the grid puts the library in the first column. */}
      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_280px] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-start-1">
          <MontageMonitor
            source={source}
            montage={montage}
            layout={layout}
            time={time}
            playing={playing}
            onTogglePlay={toggle}
            onPrevious={previous === undefined ? null : () => seek(previous)}
            onNext={next === undefined ? null : () => seek(next)}
            onStartWithAll={() => add(kills)}
          />
          <MontageTimeline
            source={source}
            montage={montage}
            layout={layout}
            time={time}
            selectedId={selectedId}
            onSelect={select}
            onSeek={seek}
            onMove={move}
            onTrim={replace}
            onRemove={remove}
          />
        </div>
        <MontageInspector
          source={source}
          montage={montage}
          layout={layout}
          selected={selected}
          problems={problems}
          onSegmentChange={replace}
          onMoveSelected={moveSelected}
          onRemoveSelected={() => selected && remove(selected.id)}
          onOptionsChange={(options: MontageOptions) => setMontage((current) => ({ ...current, options }))}
          className="lg:col-start-3 lg:row-start-1 lg:h-0 lg:min-h-full"
        />
        <KillLibrary
          source={source}
          segments={montage.segments}
          onAdd={add}
          onSelect={select}
          className="lg:col-start-1 lg:row-start-1 lg:h-0 lg:min-h-full"
        />
      </div>
      {/* On a phone the order stays at the bottom of the screen while the page scrolls, and comes to rest at the end of
          the page, above the footer, so it never covers anything there (the page drops its bottom padding for it, and
          a focused control is scrolled clear of it: `data-order-bar` in index.css). It is the last element of the page,
          so it is reached last. */}
      <div
        role="region"
        aria-label={t.montage.orderBar}
        data-order-bar=""
        className="sticky bottom-0 z-30 -mx-[clamp(16px,4vw,40px)] border-t border-border bg-card/95 lg:hidden"
      >
        <div className="flex min-h-16 items-center justify-between gap-3 px-[clamp(16px,4vw,40px)] py-2.5">
          <p
            className={cn(
              'font-mono text-[13px] tabular-nums',
              layout.total > source.limits.maxDurationSeconds && 'text-negative',
            )}
          >
            <span className="sr-only">{t.montage.inspector.duration}: </span>
            {formatDuration(layout.total)} / {formatDuration(source.limits.maxDurationSeconds)}
          </p>
          {orderAction('bar')}
        </div>
      </div>
      <ClipOrderDialog
        order={order}
        keyFirst={keyFirst}
        onClose={() => setOrder(null)}
        onOrdered={(clip) => navigate(`/clips/${clip.id}`)}
      />
      <SignInDialog open={signingIn} onOpenChange={setSigningIn} />
    </>
  )
}

/** The editor of one player's montage in one match, once it is known whose and of which. */
function MontageEditor({ matchId, playerId }: { matchId: string; playerId: string }) {
  const t = useT()
  const source = useEditorSource(matchId, playerId)
  if (source.data && source.data.rounds.length > 0) {
    return <Workbench matchId={matchId} playerId={playerId} source={source.data} />
  }
  let problem: string | null = null
  if (source.data) {
    problem = t.montage.errors.noKills
  } else if (source.isError) {
    const { code } = source.error
    problem =
      code === 'DEMO_NOT_AVAILABLE'
        ? t.montage.errors.demoNotAnalyzed
        : code === 'PLAYER_NOT_IN_MATCH'
          ? t.montage.errors.playerNotInMatch
          : errorMessage(source.error, t)
  }
  return (
    <>
      {/* The nickname is the editor's title; until there is an editor, the page is named by what it is. */}
      <h1 className="sr-only">{t.montage.title}</h1>
      <div aria-live="polite">
        {problem === null ? <EditorSkeleton /> : <EditorProblem matchId={matchId} text={problem} />}
      </div>
    </>
  )
}

/**
 * The montage editor (spec 4, "Montaj muharriri"): `/matches/:matchId/montaj?player=<playerId>`. The player's kills in
 * the match become segments of a video that is put together here and recorded by the order at the end.
 */
export default function MontagePage() {
  const t = useT()
  const { matchId } = useParams()
  const [params] = useSearchParams()
  const playerId = params.get('player')
  return (
    <main className={cn(PAGE, 'flex flex-col gap-4 pt-5 pb-18 max-lg:has-[[data-order-bar]]:pb-0')}>
      {matchId && (
        <nav aria-label={t.match.breadcrumb}>
          <ol className="flex min-h-11 items-center gap-2.5 text-sm">
            <li>
              <Link
                to={`/matches/${encodeURIComponent(matchId)}`}
                className="inline-flex min-h-11 items-center text-muted-foreground hover:text-foreground"
              >
                {t.match.title}
              </Link>
            </li>
            <li aria-current="page" className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden="true" className="text-subtle">
                /
              </span>
              <span className="truncate">{t.montage.title}</span>
            </li>
          </ol>
        </nav>
      )}
      {!matchId ? (
        <p className="text-sm text-destructive">{t.errors.matchNotFound}</p>
      ) : !playerId ? (
        <>
          <h1 className="sr-only">{t.montage.title}</h1>
          <EditorProblem matchId={matchId} text={t.montage.errors.noPlayer} />
        </>
      ) : (
        // Keyed by both: the montage, the selection and the playhead belong to one player in one match.
        <MontageEditor key={`${matchId}/${playerId}`} matchId={matchId} playerId={playerId} />
      )}
    </main>
  )
}
