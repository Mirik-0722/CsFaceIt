import { Check, X } from 'lucide-react'
import { useT } from '@/i18n'
import { DEMO_STEPS, demoStages, type DemoStepState } from '@/lib/demoStages'
import { cn } from '@/lib/utils'
import type { DemoResponse } from '@/api/types'

// The bar above a step and the colour of its name. The colour is never the only sign: each state has a mark of its
// own in front of the name, and its word for a screen reader after it.
const BAR_CLASS: Record<DemoStepState, string> = {
  done: 'bg-muted-foreground',
  current: 'bg-foreground',
  failed: 'bg-negative',
  waiting: 'bg-border',
}

const TEXT_CLASS: Record<DemoStepState, string> = {
  done: 'text-muted-foreground',
  current: 'text-foreground',
  failed: 'text-negative',
  waiting: 'text-subtle',
}

/** The mark in front of a step's name: a tick, a dot that pulses while the step is worked on, a cross, a hollow dot. */
function StepMark({ state }: { state: DemoStepState }) {
  if (state === 'done') {
    return <Check aria-hidden="true" className="size-3 shrink-0" />
  }
  if (state === 'failed') {
    return <X aria-hidden="true" className="size-3 shrink-0" />
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mx-0.5 size-2 shrink-0 rounded-full',
        state === 'current' ? 'bg-foreground motion-safe:animate-rec' : 'border border-line-strong',
      )}
    />
  )
}

interface DemoStagesProps {
  demo: Pick<DemoResponse, 'status' | 'error' | 'errorCode'>
  /**
   * Only the four bars, for a place with no room for the names (a row of a table): the names and states are still
   * there for a screen reader.
   */
  compact?: boolean
  className?: string
}

/**
 * Where a demo is on its way to an analysis, as a line of four steps: download → read → analysis → ready. It is drawn
 * from the demo it is given and nothing else, so it moves on whenever whoever shows it asks for the demo again (the
 * demo panel does, every three seconds while the demo is in progress).
 */
export default function DemoStages({ demo, compact = false, className }: DemoStagesProps) {
  const t = useT()
  const states = demoStages(demo)
  // A demo that went all the way: the last step is the result, in the colour of the "analyzed" tag.
  const finished = states.every((state) => state === 'done')
  return (
    <ol aria-label={t.demo.stages.label} className={cn('grid grid-cols-4 gap-1.5', compact && 'w-24', className)}>
      {DEMO_STEPS.map((step, index) => {
        const state = states[index]
        const result = finished && step === 'ready'
        return (
          <li key={step} className="flex min-w-0 flex-col gap-1.5">
            <span aria-hidden="true" className={cn('h-0.5', result ? 'bg-positive' : BAR_CLASS[state])} />
            <span
              className={cn(
                'flex min-w-0 items-center gap-1 font-mono text-[11px] tracking-[0.06em] uppercase',
                result ? 'text-positive' : TEXT_CLASS[state],
                compact && 'sr-only',
              )}
            >
              <StepMark state={state} />
              <span className="min-w-0 truncate">{t.demo.stages.steps[step]}</span>
              <span className="sr-only">: {t.demo.stages.state[state]}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
