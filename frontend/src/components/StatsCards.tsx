import StatTile from '@/components/StatTile'
import { useT } from '@/i18n'
import { winShareFill, winShareTone } from '@/lib/winShare'
import type { PlayerAggregateStatsResponse } from '@/api/types'

function percent(value: number | null): string | null {
  return value === null ? null : `${value.toFixed(1)}%`
}

function decimal(value: number | null, digits: number): string | null {
  return value === null ? null : value.toFixed(digits)
}

/**
 * A player's figures over the stored matches, eight cards in four columns (two below `lg`), each with its line of
 * small text. A figure without data is a dash: all of them for a player without a stored match (the line under the
 * cards gives the count), and the four that come from demos (KAST, entry, trade, clutch) until one of the player's
 * demos is analyzed, which the card's line says. Every line is made of counts the API gives (the stored matches, the
 * analyzed ones, the clutch attempts and wins), never of one multiplied out of a rounded figure. ADR is the average of
 * the stored ADR of the stored matches that have one (the demo's figure where a demo was analyzed), so its line counts
 * the stored matches.
 */
export default function StatsCards({ stats }: { stats: PlayerAggregateStatsResponse }) {
  const t = useT()
  const { matches, analyzedMatches } = stats
  const hasMatches = matches > 0
  const demoNote = analyzedMatches > 0 ? undefined : t.statsCards.needsDemo
  /** The line of a figure that exists; a figure that does not has `missing` (the reason of a demo figure) or none. */
  const line = (figure: number | null, text: string, missing?: string) => (figure === null ? missing : text)
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* The backend always sends these two as numbers; without a stored match they stand for nothing. */}
        <StatTile
          label={t.statsCards.kd}
          value={hasMatches ? stats.kd.toFixed(2) : null}
          note={hasMatches ? t.statsCards.overMatches(matches) : undefined}
          // Judged as it is written: 0.996 is written "1.00" and is good news.
          tone={Number(stats.kd.toFixed(2)) >= 1 ? 'positive' : 'negative'}
        />
        <StatTile
          label={t.statsCards.hsPercent}
          value={hasMatches ? percent(stats.hsPercent) : null}
          percent={hasMatches ? stats.hsPercent : null}
          note={hasMatches ? t.statsCards.overMatches(matches) : undefined}
        />
        <StatTile
          label={t.statsCards.adr}
          value={decimal(stats.adr, 1)}
          note={line(stats.adr, t.statsCards.averageOfMatches(matches))}
        />
        <StatTile
          label={t.statsCards.kast}
          value={percent(stats.kast)}
          percent={stats.kast}
          note={line(stats.kast, t.statsCards.overMatches(analyzedMatches), demoNote)}
        />
        <StatTile
          label={t.statsCards.entry}
          value={decimal(stats.entryKillsPerMatch, 2)}
          note={line(stats.entryKillsPerMatch, t.statsCards.averageOfMatches(analyzedMatches), demoNote)}
        />
        <StatTile
          label={t.statsCards.trade}
          value={decimal(stats.tradeKillsPerMatch, 2)}
          note={line(stats.tradeKillsPerMatch, t.statsCards.averageOfMatches(analyzedMatches), demoNote)}
        />
        <StatTile
          label={t.statsCards.clutch}
          value={percent(stats.clutchPercent)}
          percent={stats.clutchPercent}
          note={
            demoNote ??
            (stats.clutchAttempts > 0
              ? t.statsCards.clutchRecord(stats.clutchWins, stats.clutchAttempts)
              : t.statsCards.noClutch)
          }
        />
        <StatTile
          label={t.statsCards.winRate}
          value={percent(stats.winRate)}
          percent={stats.winRate}
          barClass={stats.winRate === null ? undefined : winShareFill(stats.winRate)}
          tone={stats.winRate === null ? undefined : winShareTone(stats.winRate)}
          note={line(stats.winRate, t.statsCards.overMatches(matches))}
        />
      </dl>
      <p className="text-xs text-subtle">{t.statsCards.basedOn(matches, analyzedMatches)}</p>
    </div>
  )
}
