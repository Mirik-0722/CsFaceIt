import HighlightCard from '@/components/HighlightCard'
import { useT } from '@/i18n'
import type { HighlightResponse } from '@/api/types'

/** Highlights as a grid of cards: one column on a phone, up to three on a wide screen. An empty list says so. */
export default function HighlightList({ items, showMatch }: { items: HighlightResponse[]; showMatch: boolean }) {
  const t = useT()
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.highlight.empty}</p>
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((highlight) => (
        <li key={highlight.id} className="min-w-0">
          <HighlightCard highlight={highlight} showMatch={showMatch} />
        </li>
      ))}
    </ul>
  )
}
