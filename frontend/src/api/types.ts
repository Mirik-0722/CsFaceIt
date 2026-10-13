// Mirrors the backend DTO records one to one (io.csfaceit.backend.player.dto, match.dto, demo.dto, analysis.api.dto,
// clip.dto and common.api).
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

/**
 * One side of a match; `factionId` is FACEIT's faction key (`"faction1"` or `"faction2"`). `name` is null when
 * FACEIT sends none.
 */
export interface TeamResponse {
  factionId: string
  name: string | null
  players: RosterPlayerResponse[]
}

/**
 * Match details. `mapName`, `status`, `startedAt`, `finishedAt`, `demoUrl` and `winner` are null while FACEIT has not
 * published them (a match that is still being set up or played). `winner` is a faction key (`"faction1"` or
 * `"faction2"`) that matches `TeamResponse.factionId`.
 */
export interface MatchResponse {
  matchId: string
  mapName: string | null
  status: string | null
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

/** Where a demo is in the import, parse and analysis pipeline. */
export type DemoStatus = 'QUEUED' | 'STORED' | 'PARSED' | 'ANALYZED' | 'FAILED'

/** The reasons of a failed demo that the backend names with a code, so that a page can explain them in its own words. */
export type DemoErrorCode = 'DOWNLOAD_NEEDS_ACCESS'

/**
 * The state of a match's demo. `matchId` is the FACEIT match id; `error` is set while the demo is FAILED, and while
 * it is PARSED after an analysis that failed: an English sentence for the logs. `errorCode` is the same reason as a
 * code to translate, and is null for every failure that has none. It is typed as a plain string because a newer
 * backend may name a code this page does not know; the page then shows `error` as it is.
 */
export interface DemoResponse {
  demoId: number
  matchId: string
  status: DemoStatus
  error: string | null
  errorCode: string | null
  updatedAt: string
}

export type HighlightType =
  | 'ACE'
  | 'K4'
  | 'K3'
  | 'CLUTCH_1V1'
  | 'CLUTCH_1V2'
  | 'CLUTCH_1V3'
  | 'CLUTCH_1V4'
  | 'CLUTCH_1V5'
  | 'NO_SCOPE'
  | 'KNIFE_KILL'
  | 'WALLBANG'
  | 'SMOKE_KILL'
  | 'NINJA_DEFUSE'

/** One kill inside a highlight's window; `weapon` is the raw name from the demo (`ak47`, `knife_t`). */
export interface HighlightKill {
  tick: number
  weapon: string
  headshot: boolean
  victimNickname: string
}

/**
 * One highlight of one player in one round. `playerId` is the FACEIT player id, or `steam:<SteamID>` for a player the
 * backend knows only from the demo. `side` is the player's side in that round (`"CT"` or `"T"`), null when unknown.
 * The clip window is `tickStart..tickEnd`, inside the round `roundStartTick..roundEndTick`; `kills` are the player's
 * enemy kills in the window, in tick order. `mapName` and `startedAt` are the match's, null while it has none.
 */
export interface HighlightResponse {
  id: number
  type: HighlightType
  playerId: string
  nickname: string
  roundNumber: number
  side: string | null
  tickStart: number
  tickEnd: number
  roundStartTick: number
  roundEndTick: number
  durationSeconds: number
  kills: HighlightKill[]
  matchId: string
  mapName: string | null
  startedAt: string | null
}

/** A page of a player's highlights, newest match first; `offset` and `limit` echo the request. */
export interface HighlightPageResponse {
  items: HighlightResponse[]
  offset: number
  limit: number
}

/**
 * A player's statistics over the matches the backend has stored (`matches`), `analyzedMatches` of them with a demo
 * analysis. Percentages are 0–100. A figure without data behind it is null: `winRate` without a known result, `adr`
 * without a stored ADR, and `kast`, the two per-match figures and `clutchPercent` without an analyzed demo (or, for
 * `clutchPercent`, without a clutch attempt).
 */
export interface PlayerAggregateStatsResponse {
  playerId: string
  matches: number
  analyzedMatches: number
  winRate: number | null
  kd: number
  hsPercent: number
  adr: number | null
  kast: number | null
  entryKillsPerMatch: number | null
  tradeKillsPerMatch: number | null
  clutchPercent: number | null
  clutchAttempts: number
  clutchWins: number
}

/** What a clip shows: one highlight, or every kill of a player in a match. */
export type ClipKind = 'HIGHLIGHT' | 'COMPILATION'

/** Where a clip is on its way to a video file. `DONE` and `FAILED` are final. */
export type ClipStatus = 'QUEUED' | 'RECORDING' | 'ENCODING' | 'UPLOADING' | 'DONE' | 'FAILED'

export type ClipQuality = '720p' | '1080p'

/** One kill of a clip on the timeline of its video: `offsetMs` is where the kill is in the finished file. */
export interface ClipKill {
  offsetMs: number
  weapon: string
  headshot: boolean
  victimNickname: string
}

/**
 * A clip: a request to record a video and, once it is `DONE`, the video. `matchId` and `playerId` are the FACEIT ids
 * (`playerId` is `steam:<SteamID>` for a player the backend knows only from the demo). `highlightType`, `roundNumber`
 * and `tickStart` name the highlight of a `HIGHLIGHT` clip and are null for a `COMPILATION`. `progress` is 0–100.
 * `queuePosition` is set only while `QUEUED` (the head of the queue is 1); `durationMs`, `videoUrl`, `thumbnailUrl`
 * and `expiresAt` only once `DONE` (the thumbnail only if the recorder uploaded one; `expiresAt` stays null when clips
 * are kept for good); `sizeBytes` from the upload of the video on; `finishedAt` once `DONE` or `FAILED`. `error` holds
 * the reason of a failure, or of the last attempt while the clip waits to be recorded again. `kills` is filled only
 * when one clip is asked for by its id.
 */
export interface ClipResponse {
  id: number
  kind: ClipKind
  status: ClipStatus
  progress: number
  matchId: string
  mapName: string | null
  playerId: string
  nickname: string
  highlightType: HighlightType | null
  roundNumber: number | null
  tickStart: number | null
  quality: ClipQuality
  fps: number
  durationMs: number | null
  sizeBytes: number | null
  error: string | null
  queuePosition: number | null
  videoUrl: string | null
  thumbnailUrl: string | null
  createdAt: string
  finishedAt: string | null
  expiresAt: string | null
  kills: ClipKill[]
}

/** A page of clips, newest first; `offset` and `limit` echo the request. */
export interface ClipPageResponse {
  items: ClipResponse[]
  offset: number
  limit: number
}

/**
 * Whether a recorder has been seen lately (`lastSeenAt` is null when none ever was), and how many clips wait in the
 * queue (`queued`) or are being recorded (`active`).
 */
export interface RecorderStatusResponse {
  online: boolean
  lastSeenAt: string | null
  queued: number
  active: number
}

/** The body of every error response: a stable machine-readable `code` and a human-readable `message`. */
export interface ApiErrorBody {
  code: string
  message: string
}
