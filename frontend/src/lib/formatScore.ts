import type { MatchResult } from '@/api/types'

/**
 * `13 : 9` with the player's own rounds first, or an en dash when FACEIT reported no score for one of the factions.
 * FACEIT orders the score by faction, not by player; the result tells the sides apart, because the winner has more
 * rounds. Without a known result the order stays as FACEIT sent it.
 */
export function formatScore(score: Record<string, number>, result: MatchResult): string {
  const { faction1, faction2 } = score
  if (typeof faction1 !== 'number' || typeof faction2 !== 'number') {
    return '–'
  }
  const higher = Math.max(faction1, faction2)
  const lower = Math.min(faction1, faction2)
  switch (result) {
    case 'WIN':
      return `${higher} : ${lower}`
    case 'LOSS':
      return `${lower} : ${higher}`
    default:
      return `${faction1} : ${faction2}`
  }
}
