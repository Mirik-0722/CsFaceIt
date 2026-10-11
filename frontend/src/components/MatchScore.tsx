import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { TeamStatsResponse } from '@/api/types'

/**
 * The result of a match in one line: the first team, `13 : 9`, the second team. Once the match is decided the losing
 * side is dimmed. Draws nothing unless there are exactly two teams.
 */
export default function MatchScore({ teams }: { teams: TeamStatsResponse[] }) {
  const t = useT()
  if (teams.length !== 2) {
    return null
  }
  const [first, second] = teams
  // Without a winner (a match that is still being played) neither side is dimmed.
  const decided = first.win !== second.win
  const lost = (team: TeamStatsResponse) => decided && !team.win
  return (
    // On a narrow screen the score takes the first row and the two names share the second.
    <div className="grid grid-cols-2 items-center gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <span className={cn('truncate text-lg font-semibold sm:text-right', lost(first) && 'text-muted-foreground')}>
        {first.name ?? t.stats.team}
      </span>
      <span className="order-first col-span-2 justify-self-center font-mono text-[clamp(44px,5vw,64px)] leading-none font-semibold whitespace-nowrap tabular-nums sm:order-none sm:col-span-1">
        {/* Read out as "13 : 9": the two big numbers stand side by side and would otherwise run into one. */}
        <span className="sr-only">{`${first.score} : ${second.score}`}</span>
        <span aria-hidden="true">
          <span className={cn(lost(first) && 'text-subtle')}>{first.score}</span>
          <span className="mx-[0.25em] text-subtle">:</span>
          <span className={cn(lost(second) && 'text-subtle')}>{second.score}</span>
        </span>
      </span>
      <span
        className={cn('truncate text-right text-lg font-semibold sm:text-left', lost(second) && 'text-muted-foreground')}
      >
        {second.name ?? t.stats.team}
      </span>
    </div>
  )
}
