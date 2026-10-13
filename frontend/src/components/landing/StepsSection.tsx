import type { ReactNode } from 'react'
import HighlightTag from '@/components/HighlightTag'
import StatusChip from '@/components/StatusChip'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ClipResponse, HighlightType } from '@/api/types'
import SectionTitle from './SectionTitle'

const TITLE_ID = 'home-steps-title'

// Step 2 shows a few tags of the highlights; the next section has all of them.
const SAMPLE_TAGS: HighlightType[] = ['ACE', 'K4', 'CLUTCH_1V3', 'NO_SCOPE']

// The three stops of a clip, drawn with the chip the app draws them with. No clip stands behind them: the chip reads
// the status only. A box in the colour of its stage goes round each.
const STAGES: { clip: Pick<ClipResponse, 'status' | 'progress' | 'queuePosition'>; frame: string }[] = [
  { clip: { status: 'QUEUED', progress: 0, queuePosition: null }, frame: 'border-line-strong' },
  { clip: { status: 'RECORDING', progress: 0, queuePosition: null }, frame: 'border-rec' },
  { clip: { status: 'DONE', progress: 100, queuePosition: null }, frame: 'border-line-strong' },
]

interface StepProps {
  /** `01`: the list numbers its steps for assistive technology, so the figure is only for the eye. */
  number: string
  title: string
  text: string
  /** Stands at the right of the number, level with it: what the visitor has to know about the step. */
  mark?: ReactNode
  /** An example of what the step is about, drawn: hidden from assistive technology. */
  example: ReactNode
}

function Step({ number, title, text, mark, example }: StepProps) {
  return (
    <li className="relative flex flex-col gap-3 border-t border-line-strong pt-5">
      {/* As high as a tag, so that the titles of the steps start at one height whether a step has a mark or not. */}
      <span aria-hidden="true" className="label-mono flex min-h-5.5 items-center">
        {number}
      </span>
      <h3 className="text-xl leading-[1.3] font-semibold">{title}</h3>
      {/* After the title in the document, so that a screen reader reads it with its step and not before it; by
          position it stands at the top right, level with the figure. */}
      {mark && <div className="absolute top-5 right-0">{mark}</div>}
      <p className="text-pretty text-muted-foreground">{text}</p>
      <div aria-hidden="true">{example}</div>
    </li>
  )
}

/** "From demo to clip in three steps": the demo is analyzed, the highlights are found, the clip is recorded. */
export default function StepsSection() {
  const t = useT()
  return (
    <section id="steps" aria-labelledby={TITLE_ID} className="border-t border-border">
      <div className="container-page flex flex-col gap-10 pt-18 pb-20">
        <SectionTitle id={TITLE_ID}>{t.home.steps.title}</SectionTitle>
        <ol role="list" className="grid gap-8 md:grid-cols-3">
          <Step
            number="01"
            title={t.home.steps.demo.title}
            text={t.home.steps.demo.text}
            example={
              // Where a column is too narrow for the name and the mark side by side, the mark goes below the name.
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border border-border bg-card px-3 py-1.5 font-mono text-xs">
                <span className="truncate">mirage_10-okt.dem</span>
                <span className="tracking-[0.06em] whitespace-nowrap text-positive uppercase">
                  {t.home.steps.demo.analyzed}
                </span>
              </div>
            }
          />
          <Step
            number="02"
            title={t.home.steps.highlights.title}
            text={t.home.steps.highlights.text}
            example={
              <div className="flex min-h-11 flex-wrap items-center gap-2">
                {SAMPLE_TAGS.map((type) => (
                  <HighlightTag key={type} type={type} />
                ))}
              </div>
            }
          />
          <Step
            number="03"
            title={t.home.steps.clip.title}
            text={t.home.steps.clip.text}
            // Recording is not open to visitors yet, and the step is the one place that has to say so.
            mark={<Badge variant="outline">{t.home.steps.clip.comingSoon}</Badge>}
            example={
              <div className="flex min-h-11 flex-wrap items-center gap-2">
                {/* Each arrow stays with the stage it follows, so that a line that has to break ends with an arrow. */}
                {STAGES.map((stage, index) => (
                  <span key={stage.clip.status} className="inline-flex items-center gap-2">
                    <span className={cn('inline-flex h-5.5 items-center border px-2', stage.frame)}>
                      <StatusChip clip={stage.clip} percent={false} />
                    </span>
                    {index < STAGES.length - 1 && <span className="font-mono text-xs text-subtle">→</span>}
                  </span>
                ))}
              </div>
            }
          />
        </ol>
      </div>
    </section>
  )
}
