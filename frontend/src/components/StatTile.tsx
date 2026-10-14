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
  /** The class that colours the bar's fill; the light one unless the tile says otherwise (a share of wins). */
  barClass?: string
  /**
   * Whether the figure is good or bad news (the K/D and the share of wins): the value is written in that colour and the
   * tile gets a line of it along its top edge with a tint that fades downwards. Ignored for a tile without data.
   */
  tone?: 'positive' | 'negative'
}

// The colour of a tile's tone, for the value and for the `tone-edge` utility.
const TONE_CLASS = {
  positive: 'tone-edge [--tone:var(--positive)]',
  negative: 'tone-edge [--tone:var(--negative)]',
}
const TONE_TEXT = { positive: 'text-positive', negative: 'text-negative' }

/**
 * One figure of a statistics grid (spec 3): a card of its own with a mono label, the value, a 3px bar for a
 * percentage and a line of small text. A tile without a percentage keeps the bar's place empty, so that the lines of
 * the tiles of a row stand on one level. It is a term and its description, to be placed in a `<dl>`. A `tone` colours
 * the figure and the tile's top edge; the figure itself is written, so the colour is never the only sign.
 */
export default function StatTile({ label, value, percent, note, barClass = 'bg-foreground', tone }: StatTileProps) {
  const t = useT()
  const toned = value !== null ? tone : undefined
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 border border-border bg-card p-4', toned && TONE_CLASS[toned])}>
      <dt className="label-mono">{label}</dt>
      <dd className="flex flex-col gap-2">
        <span
          className={cn(
            'font-mono text-[26px] leading-[1.15] font-semibold tabular-nums',
            value === null && 'text-subtle',
            toned && TONE_TEXT[toned],
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
              className={cn('block h-full', barClass)}
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
