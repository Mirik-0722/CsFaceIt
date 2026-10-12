import { useT } from '@/i18n'
import SampleScoreboard from './SampleScoreboard'
import SectionTitle from './SectionTitle'

const TITLE_ID = 'home-statistics-title'

/** "Beyond clips": what the analysis of a demo gives besides the clips, in words, with a scoreboard as the example. */
export default function StatisticsSection() {
  const t = useT()
  return (
    <section aria-labelledby={TITLE_ID} className="border-t border-border">
      <div className="container-page grid gap-x-14 gap-y-10 pt-18 pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <p className="label-mono">{t.home.statistics.label}</p>
          <SectionTitle id={TITLE_ID}>{t.home.statistics.title}</SectionTitle>
          <p className="max-w-[32em] text-pretty text-muted-foreground">{t.home.statistics.text}</p>
          <ul className="flex flex-col gap-2.5">
            {t.home.statistics.bullets.map((bullet) => (
              <li key={bullet} className="flex items-center gap-3">
                <span aria-hidden="true" className="size-1.5 flex-none bg-foreground" />
                {bullet}
              </li>
            ))}
          </ul>
        </div>
        <SampleScoreboard />
      </div>
    </section>
  )
}
