import { useT } from '@/i18n'
import { highlightGroup, highlightLabel } from '@/lib/highlightLabels'
import { cn } from '@/lib/utils'
import type { HighlightCount } from '@/api/overview'

interface Row {
  key: string
  label: string
  count: number
  /** ACE is the one kind drawn in the REC colour, as its tag is the one filled tag. */
  ace: boolean
}

/**
 * The highlights of a player by kind (spec 3): a row per kind with its label, a bar as long as its share of the most
 * frequent kind, and the count. The five sizes of clutch are added up into one row, since a single `1v5` says little.
 * The rows are in order of count, most first; kinds with the same count keep the order they came in.
 */
export default function HighlightBreakdown({
  highlights,
  labelledBy,
}: {
  highlights: HighlightCount[]
  labelledBy: string
}) {
  const t = useT()
  const counts = new Map<string, Row>()
  for (const { type, count } of highlights) {
    const clutch = highlightGroup(type) === 'clutch'
    const key = clutch ? 'CLUTCH' : type
    const row = counts.get(key)
    if (row) {
      row.count += count
    } else {
      counts.set(key, {
        key,
        label: clutch ? t.highlight.groupClutch : highlightLabel(type, t),
        count,
        ace: type === 'ACE',
      })
    }
  }
  const rows = [...counts.values()].sort((a, b) => b.count - a.count)
  const most = rows[0]?.count ?? 0
  return (
    <ul aria-labelledby={labelledBy} className="flex flex-col">
      {rows.map((row) => (
        <li
          key={row.key}
          className="grid min-h-9 grid-cols-[7.5rem_minmax(0,1fr)_1.75rem] items-center gap-3 text-sm"
        >
          <span className="min-w-0">{row.label}</span>
          <span aria-hidden="true" className="block h-2 bg-secondary">
            <span
              className={cn('block h-full', row.ace ? 'bg-rec' : 'bg-foreground')}
              style={{ width: `${most > 0 ? Math.round((row.count / most) * 1000) / 10 : 0}%` }}
            />
          </span>
          <span className="number-mono text-right">{row.count}</span>
        </li>
      ))}
    </ul>
  )
}
