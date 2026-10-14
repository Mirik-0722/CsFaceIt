import { Check, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import type { EditorRound, EditorSource } from '@/api/editorTypes'
import HighlightTag from '@/components/HighlightTag'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { formatDuration } from '@/lib/highlightLabels'
import {
  KILL_FILTERS,
  type KillFilter,
  type LibraryKill,
  type Segment,
  allKills,
  highlightRounds,
  matchesFilter,
  secondsOf,
  segmentWith,
} from '@/lib/montage'
import { cn } from '@/lib/utils'
import { isKnife, weaponLabel } from '@/lib/weapons'

// A side is its letters in its own colour, so the colour is never the only sign.
const SIDE_CLASS = { CT: 'text-side-ct', T: 'text-side-t' } as const

interface KillLibraryProps {
  source: EditorSource
  segments: Segment[]
  /** Adds the kills to the montage (one kill, a round, or all that the filter shows). */
  onAdd: (kills: LibraryKill[]) => void
  /** Selects the segment that holds a kill that is in the montage already. */
  onSelect: (segmentId: number) => void
  className?: string
}

/**
 * The left panel of the montage editor (spec 3, `KillLibrary`): the player's kills by round, narrowed by a filter, each
 * one a button that adds it to the montage, or selects its segment when the montage has it already. A round can be
 * added as a whole, and so can everything the filter shows.
 */
export default function KillLibrary({ source, segments, onAdd, onSelect, className }: KillLibraryProps) {
  const t = useT()
  const titleId = useId()
  const [filter, setFilter] = useState<KillFilter>('all')
  const kills = allKills(source)
  const withHighlight = highlightRounds(source)
  const shown = kills.filter((item) => matchesFilter(item, filter, withHighlight))
  const labels: Record<KillFilter, string> = t.montage.library.filters
  const rounds: { round: EditorRound; kills: LibraryKill[] }[] = []
  for (const item of shown) {
    const last = rounds[rounds.length - 1]
    if (last && last.round.number === item.round.number) {
      last.kills.push(item)
    } else {
      rounds.push({ round: item.round, kills: [item] })
    }
  }
  return (
    <section aria-labelledby={titleId} className={cn('flex min-h-0 flex-col border border-border bg-card', className)}>
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <h2 id={titleId} className="flex items-baseline gap-2">
          <span className="label-mono">{t.montage.library.title}</span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{kills.length}</span>
        </h2>
        <div role="group" aria-label={t.montage.library.filterLabel} className="grid grid-cols-2 gap-1">
          {KILL_FILTERS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={filter === kind}
              onClick={() => setFilter(kind)}
              className="inline-flex min-h-11 min-w-0 items-center justify-between gap-2 px-2.5 text-left text-[13px] font-medium text-muted-foreground -outline-offset-2 hover:text-foreground aria-pressed:bg-secondary aria-pressed:text-foreground aria-pressed:shadow-[inset_0_-2px_0_var(--foreground)]"
            >
              {/* A long name ("Highlight rounds") takes two lines rather than lose its end. */}
              <span className="min-w-0 py-1 leading-tight">{labels[kind]}</span>
              <span className="font-mono text-xs text-subtle tabular-nums">
                {kills.filter((item) => matchesFilter(item, kind, withHighlight)).length}
              </span>
            </button>
          ))}
        </div>
        <Button type="button" variant="outline" disabled={shown.length === 0} onClick={() => onAdd(shown)}>
          <Plus aria-hidden="true" />
          {t.montage.library.addAll}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rounds.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t.montage.library.empty}</p>}
        {rounds.map(({ round, kills: roundKills }) => {
          const tags = source.highlights.filter((highlight) => highlight.roundNumber === round.number)
          return (
            <div key={round.number} className="border-b border-border last:border-b-0">
              <div className="flex min-h-11 items-center gap-2 pl-4">
                <h3 className="label-mono shrink-0 text-muted-foreground">{t.montage.library.round(round.number)}</h3>
                {round.side && (
                  <span className={cn('font-mono text-[11px] font-semibold', SIDE_CLASS[round.side])}>{round.side}</span>
                )}
                <span className="flex min-w-0 flex-1 flex-wrap gap-1 overflow-hidden">
                  {tags.map((highlight) => (
                    <HighlightTag key={highlight.id} type={highlight.type} className="h-5" />
                  ))}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t.montage.library.addRoundLabel(round.number)}
                  onClick={() => onAdd(roundKills)}
                  className="shrink-0 font-mono text-xs text-muted-foreground"
                >
                  <Plus aria-hidden="true" />
                  {t.montage.library.addRound}
                </Button>
              </div>
              <ul className="flex flex-col pb-1">
                {roundKills.map(({ kill }) => {
                  const holder = segmentWith(segments, round.number, kill.tick)
                  const time = formatDuration(secondsOf(kill.tick - round.startTick, source.tickRate))
                  const weapon = isKnife(kill.weapon) ? t.highlight.knife : weaponLabel(kill.weapon)
                  const marks = [
                    kill.headshot && t.montage.marks.headshot,
                    kill.wallbang && t.montage.marks.wallbang,
                    kill.noscope && t.montage.marks.noscope,
                    kill.throughSmoke && t.montage.marks.smoke,
                  ].filter((mark): mark is string => typeof mark === 'string')
                  return (
                    <li key={kill.tick}>
                      <button
                        type="button"
                        aria-label={
                          (holder ? t.montage.library.inMontage : t.montage.library.addKill)(
                            weapon,
                            kill.victimNickname,
                            round.number,
                            time,
                          ) + (marks.length > 0 ? ` · ${marks.join(', ')}` : '')
                        }
                        onClick={() => (holder ? onSelect(holder.id) : onAdd([{ round, kill }]))}
                        className={cn(
                          'grid min-h-11 w-full grid-cols-[2.25rem_auto_minmax(0,1fr)_auto_1rem] items-center gap-x-2 px-4 text-left -outline-offset-2 hover:bg-secondary',
                          holder && 'bg-secondary',
                        )}
                      >
                        <span className="font-mono text-xs text-subtle tabular-nums">{time}</span>
                        <span className="font-mono text-[13px]">{weapon}</span>
                        <span className="truncate text-sm">{kill.victimNickname}</span>
                        <span className="flex gap-1">
                          {marks.map((mark) => (
                            <span
                              key={mark}
                              className="border border-line-strong px-1 font-mono text-[10px] leading-4 tracking-[0.06em] text-muted-foreground uppercase"
                            >
                              {mark}
                            </span>
                          ))}
                        </span>
                        {holder ? (
                          <Check aria-hidden="true" className="size-4 text-positive" />
                        ) : (
                          <Plus aria-hidden="true" className="size-4 text-muted-foreground" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
