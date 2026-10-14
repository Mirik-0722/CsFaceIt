import type { DemoStatus, HighlightType, MatchResult, MatchSource } from './types.ts'

// The answers of the two reads in `overview.ts`. They are a file of their own because the E2E fixtures type their
// answers with them, and the fixtures are compiled for Node, which can follow this file (no imports but `types.ts`,
// spelled with its extension as Node wants it) and not the hooks, which pull in React Query and the app's path aliases.

/** One map of a player's stored matches: how often it was played, won, and how the player did on it. */
export interface MapOverview {
  /** FACEIT's name of the map, `de_mirage`. */
  mapName: string
  matches: number
  wins: number
  kd: number
  /** Null when none of the matches on the map has a stored ADR. */
  adr: number | null
}

/** How many highlights of one type there are. */
export interface HighlightCount {
  type: HighlightType
  count: number
}

/** The player's stored matches by map (most played first) and highlights by type (most frequent first). Both may be empty. */
export interface PlayerOverviewResponse {
  playerId: string
  maps: MapOverview[]
  highlights: HighlightCount[]
}

/** The clips of one match, by where they are: `active` are on their way to a video, `done` have one, `failed` have none. */
export interface ClipCounts {
  done: number
  active: number
  failed: number
}

/**
 * One match of a player's list: the line of the history (`matchId`, `startedAt`, `finishedAt`, `result`, `score` are as
 * in `MatchSummary`) with what the backend stored about it. `mapName` is null while the match is not stored or has no
 * map yet; `kills`, `deaths` and `assists` are null while there is no row of statistics for the player; `adr` is null
 * unless the player's numbers in the match come from the analysis of a demo, which an analyzed match does not
 * guarantee (a demo that does not hold the player leaves it null); `demoStatus` is null for a match without a demo,
 * else the stage the demo is in. `source` says where the match is from (left out by a backend without matchmaking): a
 * matchmaking match comes wholly from the database, and its `startedAt` is the moment its demo arrived when the start
 * is not known.
 */
export interface PlayerMatchResponse {
  matchId: string
  mapName: string | null
  startedAt: string
  finishedAt: string
  result: MatchResult
  score: Record<string, number>
  kills: number | null
  deaths: number | null
  assists: number | null
  adr: number | null
  demoStatus: DemoStatus | null
  highlights: HighlightCount[]
  clips: ClipCounts
  source?: MatchSource
}

/** A page of a player's matches, newest first; `offset` and `limit` echo the request. */
export interface PlayerMatchPageResponse {
  items: PlayerMatchResponse[]
  offset: number
  limit: number
}
