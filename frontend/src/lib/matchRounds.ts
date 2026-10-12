import type { BreakdownRound, RoundSide } from '@/api/breakdownTypes'
import type { TeamStatsResponse } from '@/api/types'

export function otherSide(side: RoundSide): RoundSide {
  return side === 'CT' ? 'T' : 'CT'
}

/** The player ids of each team of the scoreboard; no roster at all unless there are exactly two teams. */
export function rostersOf(teams: TeamStatsResponse[] | undefined): ReadonlySet<string>[] {
  if (teams?.length !== 2) {
    return []
  }
  return teams.map((team) => new Set(team.players.map((player) => player.playerId)))
}

/**
 * Which team won the round: the index of the one roster that holds a winner of the round. Null when none does (the
 * players of the demo are not linked to the roster) and when both do (such a round cannot be given to either team).
 */
export function roundWinner(round: BreakdownRound, rosters: ReadonlySet<string>[]): number | null {
  const holdsWinner = rosters.map((roster) => round.winnerPlayerIds.some((playerId) => roster.has(playerId)))
  const first = holdsWinner.indexOf(true)
  return first !== -1 && holdsWinner.lastIndexOf(true) === first ? first : null
}

/**
 * The side the first team played the round on: the winning side when it won, the other one when the second team did.
 * Null when the round cannot be given to a team or has no winning side.
 */
export function firstTeamSide(round: BreakdownRound, rosters: ReadonlySet<string>[]): RoundSide | null {
  const winner = roundWinner(round, rosters)
  if (winner === null || round.winnerSide === null) {
    return null
  }
  return winner === 0 ? round.winnerSide : otherSide(round.winnerSide)
}

/**
 * The sides the two teams started the match on, in the order of the teams: those of the first round. Null when that
 * round does not tell (no rounds yet, unlinked players, no winning side): a later round may already be past the change
 * of sides, so it is not asked.
 */
export function startingSides(
  rounds: BreakdownRound[],
  teams: TeamStatsResponse[] | undefined,
): [RoundSide, RoundSide] | null {
  const first = rounds.length > 0 ? firstTeamSide(rounds[0], rostersOf(teams)) : null
  return first ? [first, otherSide(first)] : null
}

/** The rounds in the order they were played, whatever order they arrived in. */
export function byNumber(rounds: BreakdownRound[]): BreakdownRound[] {
  return [...rounds].sort((a, b) => a.number - b.number)
}
