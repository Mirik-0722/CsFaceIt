import { Minus, Plus } from 'lucide-react'
import { useId, useRef } from 'react'
import type { EditorSource, MontageAspect } from '@/api/editorTypes'
import type { ClipQuality } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import { formatDuration } from '@/lib/highlightLabels'
import { problemText } from '@/lib/montageText'
import {
  type Layout,
  type Montage,
  type MontageOptions,
  type Problem,
  type Segment,
  STEP_SECONDS,
  canNudge,
  formatTimecode,
  nudgeSegment,
  roundOf,
  secondsOf,
  segmentKills,
  segmentSeconds,
  withoutControls,
} from '@/lib/montage'
import { cn } from '@/lib/utils'
import { isKnife, weaponLabel } from '@/lib/weapons'

const SIDE_CLASS = { CT: 'text-side-ct', T: 'text-side-t' } as const

interface ChoiceProps<T extends string> {
  legend: string
  name: string
  options: readonly T[]
  value: T
  label: (option: T) => string
  hint?: (option: T) => string | undefined
  onChange: (option: T) => void
}

/** Two or more radio buttons as boxes, the chosen one in the light outline (the order dialog's boxes, compact). */
function Choice<T extends string>({ legend, name, options, value, label, hint, onChange }: ChoiceProps<T>) {
  return (
    <fieldset className="min-w-0">
      <legend className="label-mono">{legend}</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {options.map((option) => (
          <label
            key={option}
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-2.5 border px-3 py-2',
              value === option ? 'border-foreground' : 'border-line-strong',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="size-4 shrink-0 accent-foreground"
            />
            <span className="flex min-w-0 flex-col">
              <span className="font-mono text-[13px] font-semibold">{label(option)}</span>
              {hint?.(option) && <span className="text-xs leading-tight text-muted-foreground">{hint(option)}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

interface StepperProps {
  label: string
  value: string
  earlier: string
  later: string
  canEarlier: boolean
  canLater: boolean
  onEarlier: () => void
  onLater: () => void
}

/** An edge of the segment: its time from the round's start, with the buttons that move it by one step. */
function Stepper({ label, value, earlier, later, canEarlier, canLater, onEarlier, onLater }: StepperProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="icon" aria-label={earlier} disabled={!canEarlier} onClick={onEarlier}>
          <Minus aria-hidden="true" />
        </Button>
        <output className="w-17 text-center font-mono text-[15px] tabular-nums">{value}</output>
        <Button type="button" variant="outline" size="icon" aria-label={later} disabled={!canLater} onClick={onLater}>
          <Plus aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

interface MontageInspectorProps {
  source: EditorSource
  montage: Montage
  layout: Layout
  selected: Segment | null
  problems: Problem[]
  onSegmentChange: (segment: Segment) => void
  onMoveSelected: (by: -1 | 1) => void
  onRemoveSelected: () => void
  onOptionsChange: (options: MontageOptions) => void
  className?: string
}

/**
 * The right panel of the montage editor (spec 3, `MontageInspector`): the selected segment (its edges, slow motion, its
 * kills, its place), the montage's options (title, intro, music, quality, aspect), and the summary with the limits,
 * which is always in view. A limit that is passed is red, with the reason under it.
 */
export default function MontageInspector({
  source,
  montage,
  layout,
  selected,
  problems,
  onSegmentChange,
  onMoveSelected,
  onRemoveSelected,
  onOptionsChange,
  className,
}: MontageInspectorProps) {
  const t = useT()
  const ids = { title: useId(), titleCount: useId(), slowMo: useId(), intro: useId(), music: useId(), heading: useId() }
  const { options } = montage
  const { limits, tickRate } = source
  const count = montage.segments.length
  // Where focus goes when the last segment is removed from here: the section stays, the button does not.
  const segmentRef = useRef<HTMLDivElement>(null)
  const index = selected ? montage.segments.findIndex((segment) => segment.id === selected.id) : -1
  const round = selected ? roundOf(source, selected.round) : undefined
  const roundStart = round?.startTick ?? 0
  const set = (patch: Partial<MontageOptions>) => onOptionsChange({ ...options, ...patch })
  const tooLong = layout.total > limits.maxDurationSeconds
  const tooMany = count > limits.maxSegments
  const titleLength = options.title.trim().length
  const step = (edge: 'start' | 'end', by: number) => () => selected && onSegmentChange(nudgeSegment(selected, edge, by, source))
  const qualityHints: Record<ClipQuality, string> = { '720p': t.clip.order.fasterSmaller, '1080p': t.clip.order.recommended }

  return (
    <section aria-labelledby={ids.heading} className={cn('flex min-h-0 flex-col border border-border bg-card', className)}>
      <h2 id={ids.heading} className="sr-only">
        {t.montage.inspector.title}
      </h2>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* The selected segment. */}
        <div ref={segmentRef} tabIndex={-1} className="flex flex-col gap-3 border-b border-border p-4 outline-none">
          {selected && round ? (
            <>
              <h3 className="label-mono text-foreground">
                {t.montage.inspector.segment(index + 1, count)}
                {` · R${round.number}`}
                {round.side && (
                  <>
                    {' · '}
                    <span className={SIDE_CLASS[round.side]}>{round.side}</span>
                  </>
                )}
              </h3>
              <Stepper
                label={t.montage.inspector.start}
                value={formatTimecode(secondsOf(selected.startTick - roundStart, tickRate))}
                earlier={t.montage.inspector.earlier(t.montage.inspector.start)}
                later={t.montage.inspector.later(t.montage.inspector.start)}
                canEarlier={canNudge(selected, 'start', -STEP_SECONDS, source)}
                canLater={canNudge(selected, 'start', STEP_SECONDS, source)}
                onEarlier={step('start', -STEP_SECONDS)}
                onLater={step('start', STEP_SECONDS)}
              />
              <Stepper
                label={t.montage.inspector.end}
                value={formatTimecode(secondsOf(selected.endTick - roundStart, tickRate))}
                earlier={t.montage.inspector.earlier(t.montage.inspector.end)}
                later={t.montage.inspector.later(t.montage.inspector.end)}
                canEarlier={canNudge(selected, 'end', -STEP_SECONDS, source)}
                canLater={canNudge(selected, 'end', STEP_SECONDS, source)}
                onEarlier={step('end', -STEP_SECONDS)}
                onLater={step('end', STEP_SECONDS)}
              />
              <p className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{t.montage.inspector.length}</span>
                <span className="font-mono tabular-nums">
                  {t.montage.seconds(segmentSeconds(selected, tickRate).toFixed(1))}
                </span>
              </p>
              <label htmlFor={ids.slowMo} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input
                  id={ids.slowMo}
                  type="checkbox"
                  role="switch"
                  checked={selected.slowMo}
                  onChange={(event) => onSegmentChange({ ...selected, slowMo: event.target.checked })}
                  className="size-4 shrink-0 accent-foreground"
                />
                {t.montage.inspector.slowMo}
              </label>
              <div className="flex flex-col gap-1.5">
                <h4 className="label-mono">{t.montage.inspector.kills}</h4>
                {segmentKills(source, selected).length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">{t.montage.inspector.noKills}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {segmentKills(source, selected).map((kill, at) => (
                      // Two kills can share a tick (one bullet through two players): the place tells them apart.
                      <li key={`${kill.tick}-${at}`} className="flex min-w-0 items-baseline gap-2 text-[13px]">
                        <span className="shrink-0 font-mono">
                          {isKnife(kill.weapon) ? t.highlight.knife : weaponLabel(kill.weapon)}
                        </span>
                        <span className="min-w-0 truncate">{kill.victimNickname}</span>
                        {kill.headshot && (
                          <span className="font-mono text-[10px] text-muted-foreground">{t.montage.marks.headshot}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={index <= 0} onClick={() => onMoveSelected(-1)}>
                  {t.montage.inspector.moveLeft}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={index >= count - 1}
                  onClick={() => onMoveSelected(1)}
                >
                  {t.montage.inspector.moveRight}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="ml-auto"
                  onClick={() => {
                    const last = count === 1
                    onRemoveSelected()
                    if (last) {
                      segmentRef.current?.focus()
                    }
                  }}
                >
                  {t.montage.inspector.remove}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t.montage.inspector.noSegment}</p>
          )}
        </div>
        {/* The montage as a whole. */}
        <div className="flex flex-col gap-4 p-4">
          <h3 className="label-mono text-foreground">{t.montage.inspector.montage}</h3>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={ids.title} className="label-mono">
                {t.montage.inspector.titleLabel}
              </label>
              <span
                id={ids.titleCount}
                className={cn(
                  'font-mono text-[11px] tabular-nums',
                  titleLength > limits.titleMaxLength ? 'text-negative' : 'text-subtle',
                )}
              >
                {titleLength}/{limits.titleMaxLength}
              </span>
            </div>
            <Input
              id={ids.title}
              value={options.title}
              maxLength={limits.titleMaxLength}
              placeholder={t.montage.inspector.titlePlaceholder}
              aria-describedby={ids.titleCount}
              onChange={(event) => set({ title: withoutControls(event.target.value) })}
            />
          </div>
          <label htmlFor={ids.intro} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              id={ids.intro}
              type="checkbox"
              checked={options.intro}
              onChange={(event) => set({ intro: event.target.checked })}
              className="size-4 shrink-0 accent-foreground"
            />
            {t.montage.inspector.intro}
          </label>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.music} className="label-mono">
              {t.montage.inspector.music}
            </label>
            <select
              id={ids.music}
              value={options.musicTrack ?? ''}
              onChange={(event) => set({ musicTrack: event.target.value || null })}
              className="h-11 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground"
            >
              <option value="">{t.montage.inspector.noMusic}</option>
              {limits.musicTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          </div>
          <Choice<ClipQuality>
            legend={t.montage.inspector.quality}
            name="montage-quality"
            options={limits.qualities}
            value={options.quality}
            label={(option) => option}
            hint={(option) => qualityHints[option]}
            onChange={(quality) => set({ quality })}
          />
          <Choice<MontageAspect>
            legend={t.montage.inspector.aspect}
            name="montage-aspect"
            options={limits.aspects}
            value={options.aspect}
            label={(option) => option}
            hint={(option) => t.montage.inspector.aspects[option]}
            onChange={(aspect) => set({ aspect })}
          />
        </div>
      </div>
      {/* The summary stays at the bottom of the panel. */}
      <div className="flex flex-col gap-2 border-t border-border bg-background p-4">
        <h3 className="sr-only">{t.montage.inspector.summary}</h3>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t.montage.inspector.duration}</dt>
          <dd className={cn('text-right font-mono tabular-nums', tooLong && 'text-negative')}>
            {formatDuration(layout.total)} / {formatDuration(limits.maxDurationSeconds)}
          </dd>
          <dt className="text-muted-foreground">{t.montage.inspector.segments}</dt>
          <dd className={cn('text-right font-mono tabular-nums', (tooMany || count === 0) && 'text-negative')}>
            {count} / {limits.maxSegments}
          </dd>
          <dt className="text-muted-foreground">{t.montage.inspector.price}</dt>
          <dd className="text-right font-mono">{t.montage.inspector.priceValue}</dd>
        </dl>
        <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
          {problems.map((problem) => (
            <p key={`${problem.kind}-${'number' in problem ? problem.number : ''}`} className="text-sm text-negative">
              {problemText(problem, t)}
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}
