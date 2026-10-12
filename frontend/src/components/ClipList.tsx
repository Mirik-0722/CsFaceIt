import ClipCard from '@/components/ClipCard'
import { useT } from '@/i18n'
import type { ClipResponse } from '@/api/types'

/** Clips as a grid of cards: one column on a phone, up to four on a wide screen. An empty list says so. */
export default function ClipList({ items }: { items: ClipResponse[] }) {
  const t = useT()
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.clip.empty}</p>
  }
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((clip) => (
        <li key={clip.id} className="min-w-0">
          <ClipCard clip={clip} />
        </li>
      ))}
    </ul>
  )
}
