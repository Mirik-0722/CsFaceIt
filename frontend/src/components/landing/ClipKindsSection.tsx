import type { ReactNode } from 'react'
import KillTimeline from '@/components/KillTimeline'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n'
import { HIGHLIGHT_TYPES, highlightLabel } from '@/lib/highlightLabels'
import CompilationLine from './CompilationLine'
import SectionTitle from './SectionTitle'

const TITLE_ID = 'home-kinds-title'

// A made-up round on a track of 100: the clip window in it and the five kills of an ace inside the window.
const ROUND = { start: 0, end: 100, windowStart: 30, windowEnd: 64, marks: [36, 42, 47, 53, 60] }

interface KindCardProps {
  label: string
  title: string
  text: string
  /** What the card shows of its kind: a line and what it says. */
  children: ReactNode
}

function KindCard({ label, title, text, children }: KindCardProps) {
  return (
    <article className="flex flex-col gap-5 border border-border bg-card p-5 sm:p-7">
      <div className="flex flex-col gap-2.5">
        <p className="label-mono">{label}</p>
        <h3 className="heading-section">{title}</h3>
        <p className="text-pretty text-muted-foreground">{text}</p>
      </div>
      {children}
    </article>
  )
}

/** "Two kinds of clip": the highlight clip, with every kind of highlight it can be, and the compilation. */
export default function ClipKindsSection() {
  const t = useT()
  return (
    <section aria-labelledby={TITLE_ID} className="border-t border-border">
      <div className="container-page flex flex-col gap-10 pt-18 pb-20">
        <SectionTitle id={TITLE_ID}>{t.home.kinds.title}</SectionTitle>
        <div className="grid gap-6 lg:grid-cols-2">
          <KindCard
            label={t.home.kinds.highlight.label}
            title={t.home.kinds.highlight.title}
            text={t.home.kinds.highlight.text}
          >
            <KillTimeline {...ROUND} />
            {/* Every type the product finds, in the order of the filter on the match page. */}
            <ul className="flex flex-wrap gap-2">
              {HIGHLIGHT_TYPES.map((type) => (
                <li key={type}>
                  <Badge variant={type === 'ACE' ? 'default' : 'outline'} className="normal-case">
                    {highlightLabel(type, t)}
                  </Badge>
                </li>
              ))}
            </ul>
          </KindCard>
          <KindCard
            label={t.clip.compilation}
            title={t.home.kinds.compilation.title}
            text={t.home.kinds.compilation.text}
          >
            <CompilationLine />
            {/* What the line shows, in two marks; the line is a picture, so its key is hidden with it. */}
            <div aria-hidden="true" className="label-mono flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-0.5 bg-rec" />
                {t.home.kinds.legend.kill}
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3.5 border-x-2 border-foreground" />
                {t.home.kinds.legend.included}
              </span>
            </div>
          </KindCard>
        </div>
      </div>
    </section>
  )
}
