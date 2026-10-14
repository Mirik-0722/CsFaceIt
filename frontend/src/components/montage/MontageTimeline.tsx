import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from 'react'
import type { EditorSource } from '@/api/editorTypes'
import { useT } from '@/i18n'
import { formatDuration } from '@/lib/highlightLabels'
import {
  type Layout,
  type Montage,
  type Part,
  type Segment,
  formatTimecode,
  killMoments,
  roundOf,
  secondsOf,
  trimSegment,
} from '@/lib/montage'
import { cn } from '@/lib/utils'

/** The narrowest a second of the video is drawn: a longer montage scrolls in its box. */
const PX_PER_SECOND = 12

/** How far the mouse has to move with a segment held before the press is a drag and not a click. */
const DRAG_THRESHOLD = 4

/** How close to the end a ruler tick goes without its label: the width of `0:45` at the narrowest scale. */
const END_LABEL_SECONDS = 2.5

// The colour of the line on top of a segment: the player's side in its round; a round without a known side is plain.
const SIDE_BORDER = { CT: 'border-t-side-ct', T: 'border-t-side-t' } as const

interface MontageTimelineProps {
  source: EditorSource
  montage: Montage
  layout: Layout
  /** The playhead, in seconds of the video. */
  time: number
  selectedId: number | null
  /** Selects a segment and puts the playhead at its start. */
  onSelect: (segmentId: number) => void
  onSeek: (time: number) => void
  /** Moves the segment at `from` to `to` (an index in the list without it). */
  onMove: (from: number, to: number) => void
  /** Replaces a segment with its trimmed self. */
  onTrim: (segment: Segment) => void
  /** Removes a segment and selects its neighbour. */
  onRemove: (segmentId: number) => void
}

/** A segment held by the mouse: where the press was, how far it has moved, and where it would land. */
interface MoveDrag {
  kind: 'move'
  id: number
  index: number
  startX: number
  dx: number
  active: boolean
  /** The index the segment would have in the list without it. */
  target: number
}

/** An edge of a segment held by the pointer, with the segment as it was and the scale when the press began. */
interface TrimDrag {
  kind: 'trim'
  edge: 'start' | 'end'
  startX: number
  original: Segment
  secondsPerPx: number
}

/** The ruler's ticks: every 5 s for a short montage, every 10 s for a longer one. */
function rulerTicks(total: number): number[] {
  const step = total <= 60 ? 5 : 10
  const ticks: number[] = []
  for (let at = 0; at <= total; at += step) {
    ticks.push(at)
  }
  return ticks
}

/**
 * The timeline of the montage editor (spec 3, `MontageTimeline`): the ruler with the playhead, the segments of the video
 * as wide as they play, the title and intro lane and the music lane. With a mouse a segment is dragged to reorder it and
 * its edges to trim it; on a touch screen the lanes scroll instead, and the inspector's buttons reorder. The ruler is a
 * slider and the video lane a list box, so the keyboard does the rest.
 */
export default function MontageTimeline({
  source,
  montage,
  layout,
  time,
  selectedId,
  onSelect,
  onSeek,
  onMove,
  onTrim,
  onRemove,
}: MontageTimelineProps) {
  const t = useT()
  const hintId = useId()
  const trackRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef(new Map<number, HTMLDivElement>())
  // Set by a key of the list box: the newly selected option takes the focus once it is drawn.
  const focusSelected = useRef(false)
  // A drag of a segment ends with a click on it as well, which must not select it again.
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState<MoveDrag | null>(null)
  const trimRef = useRef<TrimDrag | null>(null)
  const seeking = useRef(false)
  const { parts, introEnd, total } = layout
  // Nothing is drawn as wide as nothing: an empty montage keeps a span of one second for its positions.
  const span = Math.max(total, 1)
  const at = (seconds: number) => `${(seconds / span) * 100}%`
  const moments = killMoments(layout, source)
  const title = montage.options.title.trim()
  const music = source.limits.musicTracks.find((track) => track.id === montage.options.musicTrack)
  const focusable = selectedId ?? parts[0]?.segment.id ?? null

  useEffect(() => {
    if (focusSelected.current && selectedId !== null) {
      focusSelected.current = false
      optionRefs.current.get(selectedId)?.focus()
    }
  }, [selectedId])

  /** Seconds of the video under a point of the screen. */
  function secondsAt(clientX: number): number {
    const box = trackRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) {
      return 0
    }
    return Math.min(Math.max(((clientX - box.left) / box.width) * span, 0), total)
  }

  /** Where a segment held at that point would land: the number of the other segments whose middle is before it. */
  function targetAt(clientX: number, id: number): number {
    const seconds = secondsAt(clientX)
    return parts.filter((part) => part.segment.id !== id && (part.from + part.to) / 2 < seconds).length
  }

  function seekFromRuler(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 5 : 1
    const moves: Record<string, number> = {
      ArrowLeft: time - step,
      ArrowDown: time - step,
      ArrowRight: time + step,
      ArrowUp: time + step,
      Home: 0,
      End: total,
    }
    if (event.key in moves) {
      event.preventDefault()
      onSeek(Math.min(Math.max(moves[event.key], 0), total))
    }
  }

  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && drag) {
      // A drag let go of with Escape puts the segment back where it was.
      event.preventDefault()
      setDrag(null)
      return
    }
    // The selection follows the focus (see the options' `onFocus`), so the focused option is the selected one.
    const index = parts.findIndex((part) => part.segment.id === focusable)
    if (index < 0) {
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && parts.length === 1) {
      // The last segment goes, and the lane with it: the focus moves to the ruler rather than to nowhere.
      event.preventDefault()
      onRemove(parts[0].segment.id)
      rulerRef.current?.focus()
      return
    }
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = Math.min(index + 1, parts.length - 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = Math.max(index - 1, 0)
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = parts.length - 1
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      // The page selects the neighbour, which then takes the focus.
      focusSelected.current = true
      onRemove(parts[index].segment.id)
      return
    }
    if (next !== null) {
      event.preventDefault()
      focusSelected.current = true
      onSelect(parts[next].segment.id)
    }
  }

  function onSegmentDown(event: PointerEvent<HTMLDivElement>, part: Part) {
    // Only a mouse or a pen drags a segment; a finger scrolls the lane.
    if (event.button !== 0 || event.pointerType === 'touch') {
      return
    }
    // A drag that ended where no click followed (off the segment, in some browsers) must not swallow this press's.
    suppressClick.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      kind: 'move',
      id: part.segment.id,
      index: part.index,
      startX: event.clientX,
      dx: 0,
      active: false,
      target: part.index,
    })
  }

  function onSegmentMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag) {
      return
    }
    const dx = event.clientX - drag.startX
    const active = drag.active || Math.abs(dx) > DRAG_THRESHOLD
    setDrag({ ...drag, dx, active, target: active ? targetAt(event.clientX, drag.id) : drag.target })
  }

  function onSegmentUp() {
    if (drag?.active) {
      suppressClick.current = true
      onMove(drag.index, drag.target)
    }
    setDrag(null)
  }

  function onHandleDown(event: PointerEvent<HTMLDivElement>, segment: Segment, edge: 'start' | 'end') {
    if (event.button !== 0) {
      return
    }
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    // The segment being trimmed is the one the inspector shows.
    if (segment.id !== selectedId) {
      onSelect(segment.id)
    }
    const width = trackRef.current?.getBoundingClientRect().width ?? 0
    trimRef.current = { kind: 'trim', edge, startX: event.clientX, original: segment, secondsPerPx: width > 0 ? span / width : 0 }
  }

  function onHandleMove(event: PointerEvent<HTMLDivElement>) {
    const trim = trimRef.current
    if (!trim) {
      return
    }
    const { original, edge } = trim
    // The handle moves seconds of the video; a slow-motion segment plays its demo at half speed.
    const demoSeconds = ((event.clientX - trim.startX) * trim.secondsPerPx) / (original.slowMo ? 2 : 1)
    const from = edge === 'start' ? original.startTick : original.endTick
    onTrim(trimSegment(original, edge, from + demoSeconds * source.tickRate, source, true))
  }

  function onHandleUp() {
    trimRef.current = null
  }

  // Where the dragged segment would land, as a line between the others.
  let dropAt: number | null = null
  if (drag?.active) {
    const others = parts.filter((part) => part.segment.id !== drag.id)
    dropAt = drag.target < others.length ? others[drag.target].from : (others[others.length - 1]?.to ?? introEnd)
  }

  const laneName = 'label-mono flex items-center'

  return (
    <section aria-labelledby={`${hintId}-title`} className="flex flex-col gap-3 border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${hintId}-title`} className="label-mono">
          {t.montage.timeline.title}
        </h2>
        <p id={hintId} className="text-[13px] text-muted-foreground">
          {t.montage.timeline.hint}
        </p>
      </div>
      <div className="flex">
        {/* The names of the lanes stay where they are while the lanes scroll. */}
        <div aria-hidden="true" className="flex w-22 shrink-0 flex-col gap-1 pr-2">
          <span className="h-7" />
          <span className={cn(laneName, 'h-16')}>{t.montage.timeline.video}</span>
          <span className={cn(laneName, 'h-8')}>{t.montage.timeline.titleTrack}</span>
          <span className={cn(laneName, 'h-8')}>{t.montage.timeline.music}</span>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
          <div
            ref={trackRef}
            // Its own stacking context: the playhead and a dragged segment stay under the phone's sticky order bar.
            className="relative isolate flex flex-col gap-1"
            style={{ width: `max(100%, ${Math.ceil(span * PX_PER_SECOND)}px)` }}
          >
            {/* The ruler, which is also the playhead's slider: a press or a drag puts the playhead there. */}
            <div
              ref={rulerRef}
              role="slider"
              tabIndex={0}
              aria-label={t.montage.timeline.playhead}
              aria-valuemin={0}
              aria-valuemax={Math.round(total * 10) / 10}
              aria-valuenow={Math.round(Math.min(time, total) * 10) / 10}
              aria-valuetext={`${formatTimecode(time)} / ${formatTimecode(total)}`}
              onKeyDown={seekFromRuler}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return
                }
                event.currentTarget.setPointerCapture(event.pointerId)
                seeking.current = true
                onSeek(secondsAt(event.clientX))
              }}
              onPointerMove={(event) => seeking.current && onSeek(secondsAt(event.clientX))}
              onPointerUp={() => {
                seeking.current = false
              }}
              onPointerCancel={() => {
                seeking.current = false
              }}
              className="relative h-7 cursor-pointer touch-none border-b border-line-strong -outline-offset-2 select-none"
            >
              {rulerTicks(total).map((tick) => (
                <span
                  key={tick}
                  aria-hidden="true"
                  className="absolute bottom-0 flex h-3 items-start border-l border-line-strong pl-1"
                  style={{ left: at(tick) }}
                >
                  {/* A label at the very end would be cut by the lane's edge, or run into the one before it if moved
                      left: the tick there keeps its line only. */}
                  {(tick === 0 || total - tick >= END_LABEL_SECONDS) && (
                    <span className="-mt-3.5 font-mono text-[10px] leading-none text-subtle tabular-nums">
                      {formatDuration(tick)}
                    </span>
                  )}
                </span>
              ))}
            </div>
            {/* The video lane. */}
            {parts.length === 0 ? (
              <p className="flex h-16 items-center border border-dashed border-line-strong px-3 text-[13px] text-muted-foreground">
                {t.montage.timeline.empty}
              </p>
            ) : (
              <div
                role="listbox"
                aria-label={t.montage.timeline.segments}
                aria-describedby={hintId}
                aria-orientation="horizontal"
                onKeyDown={onListKey}
                className="relative h-16"
              >
                {parts.map((part) => {
                  const { segment } = part
                  const round = roundOf(source, segment.round)
                  const selected = segment.id === selectedId
                  const moving = drag?.active && drag.id === segment.id
                  const length = part.to - part.from
                  const kills = moments.filter((moment) => moment.part.index === part.index)
                  const roundStart = round?.startTick ?? segment.startTick
                  const name = t.montage.timeline.segmentName(
                    part.index + 1,
                    segment.round,
                    formatTimecode(secondsOf(segment.startTick - roundStart, source.tickRate)),
                    formatTimecode(secondsOf(segment.endTick - roundStart, source.tickRate)),
                    kills.length,
                    segment.slowMo,
                  )
                  return (
                    <div
                      key={segment.id}
                      ref={(element) => {
                        if (element) {
                          optionRefs.current.set(segment.id, element)
                        } else {
                          optionRefs.current.delete(segment.id)
                        }
                      }}
                      role="option"
                      aria-selected={selected}
                      aria-label={name}
                      tabIndex={segment.id === focusable ? 0 : -1}
                      // The selection follows the focus: Tab into the lane selects the segment it lands on, and the
                      // inspector shows it.
                      onFocus={() => {
                        if (!selected) {
                          onSelect(segment.id)
                        }
                      }}
                      onClick={() => {
                        if (suppressClick.current) {
                          suppressClick.current = false
                          return
                        }
                        onSelect(segment.id)
                      }}
                      onPointerDown={(event) => onSegmentDown(event, part)}
                      onPointerMove={onSegmentMove}
                      onPointerUp={onSegmentUp}
                      onPointerCancel={() => setDrag(null)}
                      // A capture lost without an up or a cancel (the window lost the focus) ends the drag as well.
                      onLostPointerCapture={() => setDrag(null)}
                      className={cn(
                        // The focus ring stands 6px inside, apart from the selection's 2px ring at the edge.
                        'group absolute inset-y-0 cursor-grab overflow-hidden border-t-2 border-r border-r-background bg-secondary select-none -outline-offset-[6px]',
                        round?.side ? SIDE_BORDER[round.side] : 'border-t-line-strong',
                        selected && 'z-10 ring-2 ring-foreground ring-inset',
                        moving && 'z-20 cursor-grabbing opacity-80 shadow-lg',
                      )}
                      style={{
                        left: at(part.from),
                        width: at(length),
                        transform: moving ? `translateX(${drag?.dx ?? 0}px)` : undefined,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1.5 left-2.5 flex max-w-[calc(100%-1.25rem)] gap-1.5 truncate font-mono text-[11px] leading-none"
                      >
                        <span className="text-foreground">R{segment.round}</span>
                        <span className="text-subtle">{part.index + 1}</span>
                      </span>
                      {segment.slowMo && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute bottom-1.5 left-2.5 font-mono text-[10px] leading-none text-muted-foreground"
                        >
                          0.5×
                        </span>
                      )}
                      {kills.map((moment, index) => (
                        <span
                          // Two kills can share a tick: the place tells them apart.
                          key={`${moment.kill.tick}-${index}`}
                          aria-hidden="true"
                          className="pointer-events-none absolute top-5 bottom-4 w-0.5 bg-rec"
                          style={{ left: `${((moment.time - part.from) / (length || 1)) * 100}%` }}
                        />
                      ))}
                      {(['start', 'end'] as const).map((edge) => (
                        <div
                          key={edge}
                          aria-hidden="true"
                          onPointerDown={(event) => onHandleDown(event, segment, edge)}
                          onPointerMove={onHandleMove}
                          onPointerUp={onHandleUp}
                          onPointerCancel={onHandleUp}
                          onLostPointerCapture={onHandleUp}
                          onClick={(event) => event.stopPropagation()}
                          className={cn(
                            'absolute inset-y-0 w-2 cursor-ew-resize touch-none bg-foreground/60 opacity-0 transition-opacity group-hover:opacity-100',
                            edge === 'start' ? 'left-0' : 'right-0',
                            // On a touch screen an unseen handle would trim where a finger means to scroll: only the
                            // selected segment's handles, which are drawn, take a touch.
                            selected ? 'opacity-100' : 'pointer-coarse:pointer-events-none',
                          )}
                        />
                      ))}
                    </div>
                  )
                })}
                {dropAt !== null && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-y-1 z-30 w-0.5 -translate-x-1/2 bg-foreground"
                    style={{ left: at(dropAt) }}
                  />
                )}
              </div>
            )}
            {/* The title lane: the intro card at the start, then the title over the rest. */}
            <div aria-hidden="true" className="relative h-8">
              {introEnd > 0 && (
                <span className="absolute inset-y-0 bg-line-strong" style={{ left: 0, width: at(introEnd) }} />
              )}
              {title && (
                <span
                  className={cn('absolute inset-y-1 bg-foreground/8', introEnd === 0 && 'border-l-2 border-foreground')}
                  style={{ left: at(introEnd), right: 0 }}
                />
              )}
              {introEnd > 0 || title ? (
                // The words run over both blocks: two seconds of the intro are narrower than its name.
                <span className="absolute inset-0 flex min-w-0 items-center gap-2 px-2 text-xs">
                  {introEnd > 0 && (
                    <span className="shrink-0 font-mono text-[10px] tracking-[0.08em] uppercase">
                      {t.montage.timeline.intro}
                    </span>
                  )}
                  {title && <span className="truncate">{title}</span>}
                </span>
              ) : (
                <span className="absolute inset-y-0 left-0 flex items-center text-xs text-subtle">
                  {t.montage.timeline.noTitle}
                </span>
              )}
            </div>
            {/* The music lane: the track over the whole video, or a dashed box that says there is none. */}
            <div aria-hidden="true" className="relative h-8">
              {music ? (
                <span className="absolute inset-y-1 inset-x-0 flex items-center truncate border-l-2 border-muted-foreground bg-secondary px-2 font-mono text-[11px]">
                  ♪ {music.name}
                </span>
              ) : (
                <span className="absolute inset-y-1 inset-x-0 flex items-center border border-dashed border-line-strong px-2 text-xs text-subtle">
                  {t.montage.timeline.noMusic}
                </span>
              )}
            </div>
            {/* The playhead across the lanes, with its head on the ruler. */}
            {parts.length > 0 && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 z-40 w-0.5 -translate-x-1/2 bg-rec"
                style={{ left: at(Math.min(time, total)) }}
              >
                <span className="absolute -top-px left-1/2 size-0 -translate-x-1/2 border-x-[6px] border-t-8 border-x-transparent border-t-rec" />
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
