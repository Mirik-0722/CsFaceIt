import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

interface StatTileProps {
  label: string
  /** The figure as it is shown; `null` when there is no data behind it, which draws a dimmed dash. */
  value: string | null
  /** For a percentage: how much of the 3px bar is filled, 0–100. `null` draws the empty bar. */
  percent?: number | null
  /** The line of small text under the figure: what it is made of, or why there is none. */
  note?: string
}

/**
 * One figure of a statistics grid (spec 3): a card of its own with a mono label, the value, a 3px bar for a
 * percentage and a line of small text. A tile without a percentage keeps the bar's place empty, so that the lines of
 * the tiles of a row stand on one level. It is a term and its description, to be placed in a `<dl>`.
 */
export default function StatTile({ label, value, percent, note }: StatTileProps) {
  const t = useT()
  return (
    <div className="flex min-w-0 flex-col gap-2 border border-border bg-card p-4">
      <dt className="label-mono">{label}</dt>
      <dd className="flex flex-col gap-2">
        <span
          className={cn(
            'font-mono text-[26px] leading-[1.15] font-semibold tabular-nums',
            value === null && 'text-subtle',
          )}
        >
          {value ?? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">{t.statsCards.noData}</span>
            </>
          )}
        </span>
        {percent !== undefined ? (
          <span aria-hidden="true" className="block h-[3px] bg-line-strong">
            <span
              className="block h-full bg-foreground"
              style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }}
            />
          </span>
        ) : (
          <span aria-hidden="true" className="block h-[3px]" />
        )}
        {note && <span className="text-xs text-subtle">{note}</span>}
      </dd>
    </div>
  )
}
