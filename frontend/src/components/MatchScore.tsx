import TeamSides from '@/components/TeamSides'
import { useT } from '@/i18n'
import { hasLost } from '@/lib/hasLost'
import { cn } from '@/lib/utils'
import type { RoundSide } from '@/api/breakdownTypes'
import type { TeamStatsResponse } from '@/api/types'

interface MatchScoreProps {
  teams: TeamStatsResponse[]
  /** The sides the two teams started on, in the order of the teams, when the rounds of the demo tell them. */
  sides?: [RoundSide, RoundSide] | null
}

/**
 * The result of a match in one line: the first team, `13 : 9`, the second team, and under each name the sides the team
 * played on (`CT → T`) when they are known. Once the match is decided the losing side is dimmed: its score is
 * `text-subtle` and its name `text-muted-foreground`, as in its scoreboard. Draws nothing unless there are exactly two
 * teams.
 *
 * On a map's scenery each team's name with its sides has a scrim of its own, as large as the text (`scenery-scrim`;
 * from `sm`, under it the panel's veil is closed): a long name runs to the panel's edge, where the scrim of the block
 * around the score has faded out, and the scenery keeps the rest of the place. The block is as wide as its text but
 * never wider than its column (`max-w-full`: a name without a space cannot be broken, so without it the block would
 * stand as wide as the whole name and push it out of the panel).
 */
export default function MatchScore({ teams, sides }: MatchScoreProps) {
  const t = useT()
  if (teams.length !== 2) {
    return null
  }
  const [first, second] = teams
  // Without a winner (a match that is still being played) neither side is dimmed.
  const lost = (team: TeamStatsResponse) => hasLost(team, teams)
  return (
    // On a narrow screen the score takes the first row and the two names share the second.
    <div className="grid grid-cols-2 items-start gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-x-10">
      <div className="sm:scenery-scrim flex min-w-0 flex-col gap-0.5 [--scrim-strength:90%] sm:max-w-full sm:items-end sm:justify-self-end">
        <span className={cn('max-w-full truncate text-lg font-semibold', lost(first) && 'text-muted-foreground')}>
          {first.name ?? t.stats.team}
        </span>
        {sides && <TeamSides start={sides[0]} />}
      </div>
      <span className="score-big order-first col-span-2 justify-self-center tracking-[-0.02em] whitespace-nowrap sm:order-none sm:col-span-1">
        {/* Read out as "13 : 9": the two big numbers stand side by side and would otherwise run into one. */}
        <span className="sr-only">{`${first.score} : ${second.score}`}</span>
        <span aria-hidden="true">
          <span className={cn(lost(first) && 'text-subtle')}>{first.score}</span>
          <span className="mx-[0.25em] text-subtle">:</span>
          <span className={cn(lost(second) && 'text-subtle')}>{second.score}</span>
        </span>
      </span>
      <div className="sm:scenery-scrim flex min-w-0 flex-col items-end gap-0.5 [--scrim-strength:90%] sm:max-w-full sm:items-start sm:justify-self-start">
        <span className={cn('max-w-full truncate text-lg font-semibold', lost(second) && 'text-muted-foreground')}>
          {second.name ?? t.stats.team}
        </span>
        {sides && <TeamSides start={sides[1]} />}
      </div>
    </div>
  )
}
