// Mirrors the backend DTO records one to one (io.csfaceit.backend.player.dto, match.dto and common.api).
// java.time.Instant is serialized as an ISO-8601 string; a boxed or optional upstream value is `| null`.

/** A player's public profile; `elo` and `level` are null when the player has never played CS2. */
export interface PlayerResponse {
  playerId: string
  nickname: string
  avatar: string | null
  country: string | null
  elo: number | null
  level: number | null
}

/** The outcome of a match for one player; UNKNOWN when it cannot be determined from the history item. */
export type MatchResult = 'WIN' | 'LOSS' | 'UNKNOWN'

/** One line of a player's match history; `score` is keyed by faction (`faction1`, `faction2`). */
export interface MatchSummary {
  matchId: string
  startedAt: string
  finishedAt: string
  result: MatchResult
  score: Record<string, number>
}

/** A page of a player's match history; `offset` and `limit` echo the request. */
export interface MatchHistoryResponse {
  items: MatchSummary[]
  offset: number
  limit: number
}

export interface RosterPlayerResponse {
  playerId: string
  nickname: string
}

/** One side of a match; `factionId` is FACEIT's faction key (`"faction1"` or `"faction2"`). */
export interface TeamResponse {
  factionId: string
  name: string
  players: RosterPlayerResponse[]
}

/**
 * Match details. `mapName`, `startedAt`, `finishedAt`, `demoUrl` and `winner` are null while FACEIT has not
 * published them (a match that is still being set up or played). `winner` is a faction key (`"faction1"` or
 * `"faction2"`) that matches `TeamResponse.factionId`.
 */
export interface MatchResponse {
  matchId: string
  mapName: string | null
  status: string
  startedAt: string | null
  finishedAt: string | null
  demoUrl: string | null
  teams: TeamResponse[]
  winner: string | null
}

export interface PlayerStatsResponse {
  playerId: string
  nickname: string
  kills: number
  deaths: number
  assists: number
  headshots: number
  kdRatio: number
  krRatio: number
  adr: number
}

export interface TeamStatsResponse {
  teamId: string
  name: string | null
  score: number
  win: boolean
  players: PlayerStatsResponse[]
}

/** Per-match statistics; `mapName` is null and `teams` empty when FACEIT reports no played round. */
export interface MatchStatsResponse {
  matchId: string
  mapName: string | null
  rounds: number
  teams: TeamStatsResponse[]
}

/** The body of every error response: a stable machine-readable `code` and a human-readable `message`. */
export interface ApiErrorBody {
  code: string
  message: string
}
