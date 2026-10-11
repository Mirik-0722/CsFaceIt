import StatTile from '@/components/StatTile'
import { useT } from '@/i18n'
import type { PlayerAggregateStatsResponse } from '@/api/types'

function percent(value: number | null): string | null {
  return value === null ? null : `${value.toFixed(1)}%`
}

function decimal(value: number | null, digits: number): string | null {
  return value === null ? null : value.toFixed(digits)
}

/**
 * A player's figures over the stored matches, eight tiles in four columns (two on a phone). A figure without data is
 * a dash: all of them for a player without a stored match, and the four that come from demos (KAST, entry, trade,
 * clutch) until one of the player's demos is analyzed, which the tile's note says.
 */
export default function StatsCards({ stats }: { stats: PlayerAggregateStatsResponse }) {
  const t = useT()
  const hasMatches = stats.matches > 0
  const demoNote = stats.analyzedMatches > 0 ? undefined : t.statsCards.needsDemo
  return (
    <div className="flex flex-col gap-3">
      {/* The 1px gaps show the grid's own background: hairlines between the tiles, a border around them. */}
      <dl className="grid grid-cols-2 gap-px border border-border bg-border lg:grid-cols-4">
        {/* The backend always sends these two as numbers; without a stored match they stand for nothing. */}
        <StatTile label={t.statsCards.kd} value={hasMatches ? stats.kd.toFixed(2) : null} />
        <StatTile
          label={t.statsCards.hsPercent}
          value={hasMatches ? percent(stats.hsPercent) : null}
          percent={hasMatches ? stats.hsPercent : null}
        />
        <StatTile label={t.statsCards.adr} value={decimal(stats.adr, 1)} />
        <StatTile label={t.statsCards.kast} value={percent(stats.kast)} percent={stats.kast} note={demoNote} />
        <StatTile label={t.statsCards.entry} value={decimal(stats.entryKillsPerMatch, 2)} note={demoNote} />
        <StatTile label={t.statsCards.trade} value={decimal(stats.tradeKillsPerMatch, 2)} note={demoNote} />
        <StatTile
          label={t.statsCards.clutch}
          value={percent(stats.clutchPercent)}
          percent={stats.clutchPercent}
          note={
            demoNote ??
            (stats.clutchAttempts > 0 ? t.statsCards.clutchRecord(stats.clutchWins, stats.clutchAttempts) : undefined)
          }
        />
        <StatTile label={t.statsCards.winRate} value={percent(stats.winRate)} percent={stats.winRate} />
      </dl>
      <p className="text-xs text-subtle">{t.statsCards.basedOn(stats.matches, stats.analyzedMatches)}</p>
    </div>
  )
}
