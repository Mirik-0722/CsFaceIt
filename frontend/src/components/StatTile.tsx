import { cn } from '@/lib/utils'

interface StatTileProps {
  label: string
  /** The figure as it is shown; `null` when there is no data behind it, which draws a dimmed dash. */
  value: string | null
  /** For a percentage: how much of the 3px bar is filled, 0–100. `null` draws the empty bar. */
  percent?: number | null
  note?: string
}

/**
 * One figure of a statistics grid (spec 3): a mono label, the value, a bar for a percentage and a short note. It is a
 * term and its description, to be placed in a `<dl>`.
 */
export default function StatTile({ label, value, percent, note }: StatTileProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 bg-card p-4">
      <dt className="label-mono">{label}</dt>
      <dd className="flex flex-col gap-2.5">
        <span
          className={cn(
            'font-mono text-[26px] leading-none font-semibold tabular-nums',
            value === null && 'text-subtle',
          )}
        >
          {value ?? '—'}
        </span>
        {percent !== undefined && (
          <span aria-hidden="true" className="block h-[3px] bg-line-strong">
            <span
              className="block h-full bg-foreground"
              style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }}
            />
          </span>
        )}
        {note && <span className="text-xs text-subtle">{note}</span>}
      </dd>
    </div>
  )
}
