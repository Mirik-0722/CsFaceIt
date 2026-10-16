import type { ReactNode } from 'react'
import HighlightCard from '@/components/HighlightCard'
import { useT } from '@/i18n'
import type { HighlightResponse } from '@/api/types'

interface HighlightListProps {
  items: HighlightResponse[]
  showMatch: boolean
  /** What can be done about a highlight, as the last row of its card (the clip button of the match page). */
  action?: (highlight: HighlightResponse) => ReactNode
}

/**
 * Highlights as a grid of cards: up to three on a wide screen. Under `md` a card is a row of a list (spec 5.1), and the
 * rows follow each other without a gap: the line under each one parts them. An empty list says so.
 */
export default function HighlightList({ items, showMatch, action }: HighlightListProps) {
  const t = useT()
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.highlight.empty}</p>
  }
  return (
    <ul className="grid gap-4 max-md:gap-y-0 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((highlight) => (
        <li key={highlight.id} className="min-w-0">
          <HighlightCard highlight={highlight} showMatch={showMatch} action={action?.(highlight)} />
        </li>
      ))}
    </ul>
  )
}
