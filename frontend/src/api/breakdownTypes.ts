// The answer of the read in `breakdown.ts`. It is a file of its own, without an import, because the E2E fixtures type
// their answers with it: the fixtures are compiled for Node, which can follow this file and not the hook, which pulls in
// React Query and the app's path aliases.

/** A side of a round. */
export type RoundSide = 'CT' | 'T'

/**
 * One round of the analyzed demo. `winnerSide` is null when the demo does not say who won. `winnerPlayerIds` are the
 * players of the winning side, by the ids the match stats use for a player; for a demo whose players are not linked to
 * the roster none of them occurs in the stats.
 */
export interface BreakdownRound {
  number: number
  winnerSide: RoundSide | null
  winnerPlayerIds: string[]
}

/**
 * What the demo analysis computed for one player of the match; a figure it could not compute is null. `kast` is 0–100.
 */
export interface BreakdownPlayer {
  playerId: string
  kast: number | null
  entryKills: number | null
  tradeKills: number | null
  clutchWins: number | null
  clutchAttempts: number | null
}

/**
 * The rounds of a match, by number, and the per-player figures of its demo analysis. Both lists are empty until the
 * demo of the match has been analyzed, and a player of the roster may have no entry.
 */
export interface MatchBreakdownResponse {
  matchId: string
  rounds: BreakdownRound[]
  players: BreakdownPlayer[]
}
