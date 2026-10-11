import type { TeamStatsResponse } from '@/api/types'

/**
 * Whether `team` lost a decided match: there are two teams and exactly one of them won. While a match is still being
 * played (no winner yet) nobody has lost, so nobody is dimmed.
 */
export function hasLost(team: TeamStatsResponse, teams: TeamStatsResponse[]): boolean {
  return teams.length === 2 && teams[0].win !== teams[1].win && !team.win
}
