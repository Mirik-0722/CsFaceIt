// API responses for the E2E flow, typed with the frontend's own interfaces. The values mirror the backend test fixtures
// (backend/src/test/resources/faceit): s1mple, ELO 3500, level 10; match 1-aaaa... won 13 : 9 on de_mirage.
// The values are chosen for Playwright's strict locators: `25` is in exactly one stats cell, and `de_mirage` and
// `ELO 3500` appear once on their pages.
import type {
  ClipResponse,
  ClipStatus,
  DemoResponse,
  HighlightPageResponse,
  HighlightResponse,
  HighlightType,
  MatchHistoryResponse,
  MatchResponse,
  MatchStatsResponse,
  PlayerAggregateStatsResponse,
  PlayerResponse,
  RecorderStatusResponse,
} from '../src/api/types.ts'

export const PLAYER_ID = '11111111-1111-1111-1111-111111111111'
export const WON_MATCH_ID = '1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
export const LOST_MATCH_ID = '1-bbbbbbbb-cccc-dddd-eeee-ffffffffffff'

const TEAM_A_ID = 'fac10000-0000-4000-8000-000000000001'
const TEAM_B_ID = 'fac10000-0000-4000-8000-000000000002'

export const playerFixture: PlayerResponse = {
  playerId: PLAYER_ID,
  nickname: 's1mple',
  // The backend fixture has an avatar URL; null keeps the browser from requesting a host outside the mocked API.
  avatar: null,
  country: 'ua',
  elo: 3500,
  level: 10,
}

/** One page of history: a win (13 : 9) and a loss (16 : 14 for the other faction, shown as 14 : 16: the player's rounds first). */
export const historyFixture: MatchHistoryResponse = {
  items: [
    {
      matchId: WON_MATCH_ID,
      startedAt: '2023-11-14T22:13:20Z',
      finishedAt: '2023-11-14T22:53:20Z',
      result: 'WIN',
      score: { faction1: 13, faction2: 9 },
    },
    {
      matchId: LOST_MATCH_ID,
      startedAt: '2023-11-14T19:26:40Z',
      finishedAt: '2023-11-14T20:16:40Z',
      result: 'LOSS',
      score: { faction1: 16, faction2: 14 },
    },
  ],
  offset: 0,
  limit: 20,
}

export const matchFixture: MatchResponse = {
  matchId: WON_MATCH_ID,
  mapName: 'de_mirage',
  status: 'FINISHED',
  startedAt: '2023-11-14T22:13:20Z',
  finishedAt: '2023-11-14T22:53:20Z',
  demoUrl: 'https://demos.example/1.dem.gz',
  teams: [
    {
      factionId: 'faction1',
      name: 'team_A',
      players: [
        { playerId: PLAYER_ID, nickname: 's1mple' },
        { playerId: '22222222-2222-2222-2222-222222222222', nickname: 'playerA2' },
        { playerId: '33333333-3333-3333-3333-333333333333', nickname: 'playerA3' },
        { playerId: '44444444-4444-4444-4444-444444444444', nickname: 'playerA4' },
        { playerId: '55555555-5555-5555-5555-555555555555', nickname: 'playerA5' },
      ],
    },
    {
      factionId: 'faction2',
      name: 'team_B',
      players: [
        { playerId: '66666666-6666-6666-6666-666666666666', nickname: 'playerB1' },
        { playerId: '77777777-7777-7777-7777-777777777777', nickname: 'playerB2' },
        { playerId: '88888888-8888-8888-8888-888888888888', nickname: 'playerB3' },
        { playerId: '99999999-9999-9999-9999-999999999999', nickname: 'playerB4' },
        { playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', nickname: 'playerB5' },
      ],
    },
  ],
  winner: 'faction1',
}

export const statsFixture: MatchStatsResponse = {
  matchId: WON_MATCH_ID,
  mapName: 'de_mirage',
  rounds: 22,
  teams: [
    {
      teamId: TEAM_A_ID,
      name: 'team_A',
      score: 13,
      win: true,
      players: [
        { playerId: PLAYER_ID, nickname: 's1mple', kills: 25, deaths: 14, assists: 3, headshots: 12, kdRatio: 1.79, krRatio: 1.14, adr: 95.4 },
        { playerId: '22222222-2222-2222-2222-222222222222', nickname: 'playerA2', kills: 18, deaths: 13, assists: 5, headshots: 8, kdRatio: 1.38, krRatio: 0.82, adr: 78.2 },
        { playerId: '33333333-3333-3333-3333-333333333333', nickname: 'playerA3', kills: 15, deaths: 13, assists: 6, headshots: 7, kdRatio: 1.15, krRatio: 0.68, adr: 70.1 },
        { playerId: '44444444-4444-4444-4444-444444444444', nickname: 'playerA4', kills: 12, deaths: 12, assists: 4, headshots: 5, kdRatio: 1.0, krRatio: 0.55, adr: 61.5 },
        { playerId: '55555555-5555-5555-5555-555555555555', nickname: 'playerA5', kills: 10, deaths: 12, assists: 7, headshots: 4, kdRatio: 0.83, krRatio: 0.45, adr: 55.3 },
      ],
    },
    {
      teamId: TEAM_B_ID,
      name: 'team_B',
      score: 9,
      win: false,
      players: [
        { playerId: '66666666-6666-6666-6666-666666666666', nickname: 'playerB1', kills: 17, deaths: 17, assists: 4, headshots: 9, kdRatio: 1.0, krRatio: 0.77, adr: 80.6 },
        { playerId: '77777777-7777-7777-7777-777777777777', nickname: 'playerB2', kills: 14, deaths: 16, assists: 3, headshots: 6, kdRatio: 0.88, krRatio: 0.64, adr: 71.9 },
        { playerId: '88888888-8888-8888-8888-888888888888', nickname: 'playerB3', kills: 13, deaths: 16, assists: 5, headshots: 5, kdRatio: 0.81, krRatio: 0.59, adr: 66.4 },
        { playerId: '99999999-9999-9999-9999-999999999999', nickname: 'playerB4', kills: 11, deaths: 16, assists: 2, headshots: 4, kdRatio: 0.69, krRatio: 0.5, adr: 58.7 },
        { playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', nickname: 'playerB5', kills: 9, deaths: 15, assists: 6, headshots: 3, kdRatio: 0.6, krRatio: 0.41, adr: 49.8 },
      ],
    },
  ],
}

/** s1mple over twelve stored matches, five of them with an analyzed demo. */
export const playerStatsFixture: PlayerAggregateStatsResponse = {
  playerId: PLAYER_ID,
  matches: 12,
  analyzedMatches: 5,
  winRate: 58.3,
  kd: 1.31,
  hsPercent: 47.3,
  adr: 86.2,
  kast: 73.4,
  entryKillsPerMatch: 2.4,
  tradeKillsPerMatch: 1.8,
  clutchPercent: 12.5,
  clutchAttempts: 16,
  clutchWins: 2,
}

export const demoFixture: DemoResponse = {
  demoId: 1,
  matchId: WON_MATCH_ID,
  status: 'ANALYZED',
  error: null,
  updatedAt: '2023-11-14T23:10:00Z',
}

const TICK_RATE = 64
const ROUND_SECONDS = 100
const S1MPLE = { playerId: PLAYER_ID, nickname: 's1mple' }
const PLAYER_B1 = { playerId: '66666666-6666-6666-6666-666666666666', nickname: 'playerB1' }

/** One kill of a highlight: the second of the round it happened in, the weapon as the demo names it, headshot or not. */
type Kill = [second: number, weapon: string, headshot?: boolean]

/**
 * A highlight of the won match as the backend would build it: the round is 100 seconds long, the clip window opens
 * three seconds before the first kill and closes two seconds after the last (a highlight without a kill is the ten
 * seconds before the 80th second, a defuse).
 */
export function highlightFixture(
  id: number,
  type: HighlightType,
  player: { playerId: string; nickname: string },
  roundNumber: number,
  side: string | null,
  kills: Kill[],
): HighlightResponse {
  const roundStartTick = roundNumber * 9000
  const roundEndTick = roundStartTick + ROUND_SECONDS * TICK_RATE
  const ticks = kills.map(([second]) => roundStartTick + second * TICK_RATE)
  const first = ticks.length > 0 ? Math.min(...ticks) : roundStartTick + 70 * TICK_RATE
  const last = ticks.length > 0 ? Math.max(...ticks) : roundStartTick + 80 * TICK_RATE
  // A highlight with kills gets the three seconds before and the two after; one without is the defuse itself.
  const tickStart = Math.max(roundStartTick, ticks.length > 0 ? first - 3 * TICK_RATE : first)
  const tickEnd = Math.min(roundEndTick, ticks.length > 0 ? last + 2 * TICK_RATE : last)
  return {
    id,
    type,
    playerId: player.playerId,
    nickname: player.nickname,
    roundNumber,
    side,
    tickStart,
    tickEnd,
    roundStartTick,
    roundEndTick,
    durationSeconds: Math.round((tickEnd - tickStart) / TICK_RATE),
    kills: kills.map(([second, weapon, headshot = false], index) => ({
      tick: roundStartTick + second * TICK_RATE,
      weapon,
      headshot,
      victimNickname: `victim${index + 1}`,
    })),
    matchId: WON_MATCH_ID,
    mapName: 'de_mirage',
    startedAt: '2023-11-14T22:13:20Z',
  }
}

/** The highlights of the won match, in round order: every group of the filter has some. */
export const matchHighlightsFixture: HighlightResponse[] = [
  highlightFixture(1, 'K3', S1MPLE, 3, 'CT', [[31, 'm4a1_silencer', true], [34, 'm4a1_silencer'], [41, 'usp_silencer', true]]),
  highlightFixture(2, 'WALLBANG', PLAYER_B1, 5, 'T', [[52, 'ak47']]),
  highlightFixture(3, 'CLUTCH_1V3', S1MPLE, 9, 'CT', [[71, 'awp'], [79, 'awp', true], [88, 'deagle', true]]),
  highlightFixture(4, 'NINJA_DEFUSE', S1MPLE, 11, 'CT', []),
  highlightFixture(5, 'ACE', S1MPLE, 14, 'T', [[22, 'ak47', true], [24, 'ak47'], [27, 'ak47', true], [33, 'ak47'], [36, 'ak47', true]]),
  highlightFixture(6, 'NO_SCOPE', PLAYER_B1, 17, 'CT', [[48, 'awp']]),
  highlightFixture(7, 'K4', PLAYER_B1, 19, 'CT', [[18, 'famas'], [21, 'famas', true], [29, 'famas'], [44, 'p250', true]]),
  highlightFixture(8, 'SMOKE_KILL', S1MPLE, 20, 'T', [[63, 'galilar']]),
  highlightFixture(9, 'KNIFE_KILL', S1MPLE, 22, 'T', [[57, 'knife_t']]),
]

/** The profile's "newest highlights": the player's own, as one page of six. */
export const playerHighlightsFixture: HighlightPageResponse = {
  items: matchHighlightsFixture.filter((highlight) => highlight.playerId === PLAYER_ID),
  offset: 0,
  limit: 6,
}

/** A recorder that is online, with one clip being recorded and one waiting. */
export const recorderStatusFixture: RecorderStatusResponse = {
  online: true,
  lastSeenAt: '2023-11-14T23:30:00Z',
  queued: 1,
  active: 1,
}

/**
 * The clip of a highlight as the backend would describe it in a list, in the given state: a finished clip has its
 * length, size and video address, a queued one its place in the queue. `thumbnailUrl` stays null also for a finished
 * clip, so that the browser asks for nothing outside the mocked API; the frame then shows the scene of the map.
 */
export function clipFixture(
  id: number,
  highlight: HighlightResponse,
  status: ClipStatus,
  overrides: Partial<ClipResponse> = {},
): ClipResponse {
  const done = status === 'DONE'
  return {
    id,
    kind: 'HIGHLIGHT',
    status,
    progress: done ? 100 : 0,
    matchId: highlight.matchId,
    mapName: highlight.mapName,
    playerId: highlight.playerId,
    nickname: highlight.nickname,
    highlightType: highlight.type,
    roundNumber: highlight.roundNumber,
    tickStart: highlight.tickStart,
    quality: '1080p',
    fps: 60,
    durationMs: done ? highlight.durationSeconds * 1000 : null,
    sizeBytes: done ? highlight.durationSeconds * 1_400_000 : null,
    error: null,
    queuePosition: status === 'QUEUED' ? 1 : null,
    videoUrl: done ? `/api/v1/clips/${id}/video` : null,
    thumbnailUrl: null,
    createdAt: '2023-11-14T23:20:00Z',
    finishedAt: done || status === 'FAILED' ? '2023-11-14T23:24:00Z' : null,
    expiresAt: done ? '2023-12-14T23:24:00Z' : null,
    kills: [],
    ...overrides,
  }
}

/**
 * A clip as `GET /api/v1/clips/{id}` answers it: with the kills of its highlight on the timeline of the video, which
 * starts where the clip window starts.
 */
export function clipDetailFixture(clip: ClipResponse, highlight: HighlightResponse): ClipResponse {
  return {
    ...clip,
    kills: highlight.kills.map((kill) => ({
      offsetMs: Math.round(((kill.tick - highlight.tickStart) / TICK_RATE) * 1000),
      weapon: kill.weapon,
      headshot: kill.headshot,
      victimNickname: kill.victimNickname,
    })),
  }
}
