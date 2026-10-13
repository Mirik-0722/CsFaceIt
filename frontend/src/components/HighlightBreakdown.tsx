import { useT } from '@/i18n'
import { highlightGroup, highlightKindName, type HighlightGroup } from '@/lib/highlightLabels'
import { cn } from '@/lib/utils'
import type { HighlightCount } from '@/api/overview'

interface Row {
  key: string
  label: string
  count: number
  /** The family of the kind, which colours its bar as it colours the kind's tag. */
  group: HighlightGroup
}

// The fill of a bar in the colour of its family (spec 2.1): multi-kills, clutches, the special kinds.
const FILL: Record<HighlightGroup, string> = {
  multi: 'bg-hl-multi',
  clutch: 'bg-hl-clutch',
  special: 'bg-hl-special',
}

/**
 * The highlights of a player by kind (spec 3): a row per kind with its label, a bar as long as its share of the most
 * frequent kind (in the colour of the kind's family), and the count. The five sizes of clutch are added up into one row, since a single `1v5` says little.
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
    const group = highlightGroup(type)
    const clutch = group === 'clutch'
    const key = clutch ? 'CLUTCH' : type
    const row = counts.get(key)
    if (row) {
      row.count += count
    } else {
      counts.set(key, {
        key,
        label: clutch ? t.highlight.groupClutch : highlightKindName(type, t),
        count,
        group,
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
              className={cn('block h-full', FILL[row.group])}
              style={{ width: `${most > 0 ? Math.round((row.count / most) * 1000) / 10 : 0}%` }}
            />
          </span>
          <span className="number-mono text-right">{row.count}</span>
        </li>
      ))}
    </ul>
  )
}
