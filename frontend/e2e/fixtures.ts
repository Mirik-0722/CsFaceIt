// API responses for the E2E flow, typed with the frontend's own interfaces. The values mirror the backend test fixtures
// (backend/src/test/resources/faceit): s1mple, ELO 3500, level 10; match 1-aaaa... won 13 : 9 on de_mirage.
// The values are chosen for Playwright's strict locators: `25` is in exactly one stats cell (no figure of the breakdown
// reads `25` either), and `ELO 3500` appears once on its page.
import type { BreakdownRound, MatchBreakdownResponse, RoundSide } from '../src/api/breakdownTypes.ts'
import type {
  PlayerMatchPageResponse,
  PlayerMatchResponse,
  PlayerOverviewResponse,
} from '../src/api/overviewTypes.ts'
import type {
  ClipResponse,
  ClipStatus,
  DemoResponse,
  DemoStatus,
  HighlightPageResponse,
  HighlightResponse,
  HighlightType,
  MatchHistoryResponse,
  MatchResponse,
  MatchResult,
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

// The rounds team_A won, of the 22 of the won match (13 : 9): seven of the first twelve, which it played as CT, and six
// of the ten after the change of sides, the last of them the round that ended the match. They agree with the highlights
// below: the round of each highlight that only the winner of a round can have (a clutch, a defuse) is its player's.
const TEAM_A_ROUNDS = [1, 2, 3, 5, 7, 9, 11, 13, 14, 16, 18, 20, 22]
const HALF = 12

/** The rounds of the won match, the winners of each named by the ids `players` gives the two teams. */
function roundsFixture(players: [teamA: string[], teamB: string[]]): BreakdownRound[] {
  return Array.from({ length: 22 }, (_, index): BreakdownRound => {
    const number = index + 1
    const wonByA = TEAM_A_ROUNDS.includes(number)
    // team_A starts as CT; the side that wins a round is the side its winner is on in that half.
    const sideOfA: RoundSide = number <= HALF ? 'CT' : 'T'
    const sideOfB: RoundSide = number <= HALF ? 'T' : 'CT'
    return { number, winnerSide: wonByA ? sideOfA : sideOfB, winnerPlayerIds: players[wonByA ? 0 : 1] }
  })
}

/** What the demo analysis computed for a player: KAST, entry kills, trade kills, clutches won and tried. */
type Figures = [kast: number, entryKills: number, tradeKills: number, clutchWins: number, clutchAttempts: number]

/**
 * The breakdown of the won match: its 22 rounds with the rosters of the stats as winners, and the figures of nine of
 * the ten players. playerA5 never stood alone (no clutch to show) and playerB5 has no entry at all, as a player the
 * analysis could not follow has none.
 */
export const breakdownFixture: MatchBreakdownResponse = {
  matchId: WON_MATCH_ID,
  rounds: roundsFixture([
    statsFixture.teams[0].players.map((player) => player.playerId),
    statsFixture.teams[1].players.map((player) => player.playerId),
  ]),
  players: (
    [
      [77.3, 5, 3, 1, 2],
      [72.7, 3, 4, 0, 1],
      [68.2, 2, 2, 1, 1],
      [63.6, 1, 3, 0, 2],
      [59.1, 1, 1, 0, 0],
      [68.2, 4, 2, 1, 3],
      [63.6, 2, 3, 0, 1],
      [59.1, 2, 1, 0, 2],
      [54.5, 1, 2, 0, 1],
    ] satisfies Figures[]
  ).map(([kast, entryKills, tradeKills, clutchWins, clutchAttempts], index) => ({
    playerId: statsFixture.teams.flatMap((team) => team.players)[index].playerId,
    kast,
    entryKills,
    tradeKills,
    clutchWins,
    clutchAttempts,
  })),
}

/**
 * The same match when the players of its demo are not linked to the roster: every id is a `steam:` one that the stats do
 * not have, so no round can be given to a team and no figure to a row.
 */
export const unlinkedBreakdownFixture: MatchBreakdownResponse = {
  matchId: WON_MATCH_ID,
  rounds: roundsFixture([
    [1, 2, 3, 4, 5].map((player) => `steam:7656119800000000${player}`),
    [6, 7, 8, 9, 0].map((player) => `steam:7656119800000000${player}`),
  ]),
  players: breakdownFixture.players.map((player, index) => ({
    ...player,
    playerId: `steam:7656119800000000${(index + 1) % 10}`,
  })),
}

/** The breakdown of a match whose demo has not been analyzed (or that the site does not know): both lists empty. */
export const emptyBreakdownFixture: MatchBreakdownResponse = { matchId: WON_MATCH_ID, rounds: [], players: [] }

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

/**
 * The same player's stored matches by map and highlights by kind: twelve matches (seven of them won) as in
 * `playerStatsFixture`, the last map without a stored ADR, and nine kinds once the five sizes of clutch are added up.
 */
export const playerOverviewFixture: PlayerOverviewResponse = {
  playerId: PLAYER_ID,
  maps: [
    { mapName: 'de_mirage', matches: 5, wins: 3, kd: 1.52, adr: 93.4 },
    { mapName: 'de_inferno', matches: 3, wins: 2, kd: 1.18, adr: 84.1 },
    { mapName: 'de_ancient', matches: 2, wins: 1, kd: 1.26, adr: 85.0 },
    { mapName: 'de_nuke', matches: 1, wins: 1, kd: 1.41, adr: 88.7 },
    { mapName: 'de_dust2', matches: 1, wins: 0, kd: 0.97, adr: null },
  ],
  highlights: [
    { type: 'K3', count: 9 },
    { type: 'SMOKE_KILL', count: 4 },
    { type: 'CLUTCH_1V1', count: 3 },
    { type: 'WALLBANG', count: 3 },
    { type: 'CLUTCH_1V2', count: 2 },
    { type: 'K4', count: 2 },
    { type: 'CLUTCH_1V3', count: 1 },
    { type: 'ACE', count: 1 },
    { type: 'NO_SCOPE', count: 1 },
    { type: 'NINJA_DEFUSE', count: 1 },
    { type: 'KNIFE_KILL', count: 1 },
  ],
}

/** The fields of a row of the matches page that a row of the table below spells out; the rest follows from them. */
type MatchRow = [
  mapName: string | null,
  startedAt: string,
  result: MatchResult,
  score: [own: number, other: number] | null,
  kda: [kills: number, deaths: number, assists: number] | null,
  adr: number | null,
  demoStatus: DemoStatus | null,
  highlights: [HighlightType, number][],
  clips: [done: number, active: number, failed: number],
]

function playerMatchFixture(index: number, row: MatchRow): PlayerMatchResponse {
  const [mapName, startedAt, result, score, kda, adr, demoStatus, highlights, [done, active, failed]] = row
  // FACEIT orders the score by faction: the winner has more rounds, so a won match is the first faction's here.
  const [own, other] = score ?? [0, 0]
  const startedMs = Date.parse(startedAt)
  return {
    matchId: `1-pm-${String(index).padStart(2, '0')}`,
    mapName,
    startedAt,
    finishedAt: new Date(startedMs + 45 * 60 * 1000).toISOString(),
    result,
    score: score === null ? {} : result === 'LOSS' ? { faction1: other, faction2: own } : { faction1: own, faction2: other },
    kills: kda?.[0] ?? null,
    deaths: kda?.[1] ?? null,
    assists: kda?.[2] ?? null,
    adr,
    demoStatus,
    highlights: highlights.map(([type, count]) => ({ type, count })),
    clips: { done, active, failed },
  }
}

/**
 * A full page (20 rows, so the page offers "Show more") of the matches of the player, newest first, in every state a
 * row can be in: the strongest highlight an ace, a four-kill, a triple kill and a clutch; a demo that was never
 * uploaded, one that is being read and one that failed; an analyzed demo without a highlight; a clip being recorded and
 * one ready; a match without a map and one without a stored line; and two matches of last year.
 */
export const playerMatchesFixture: PlayerMatchPageResponse = {
  items: (
    [
      ['de_mirage', '2026-10-10T21:40:00', 'WIN', [13, 11], [27, 15, 4], 98.4, 'ANALYZED', [['ACE', 1], ['CLUTCH_1V3', 1], ['CLUTCH_1V1', 1], ['K3', 1], ['WALLBANG', 1]], [1, 1, 0]],
      ['de_inferno', '2026-10-10T20:35:00', 'LOSS', [9, 13], [18, 17, 5], 77.0, 'ANALYZED', [['K3', 1]], [0, 0, 0]],
      ['de_ancient', '2026-10-09T23:10:00', 'WIN', [13, 7], [22, 11, 6], 91.2, 'ANALYZED', [['K4', 1], ['CLUTCH_1V2', 1], ['K3', 1]], [1, 0, 0]],
      ['de_anubis', '2026-10-09T22:15:00', 'WIN', [13, 10], [19, 14, 7], 80.5, 'PARSED', [], [0, 0, 0]],
      ['de_dust2', '2026-10-08T21:05:00', 'LOSS', [11, 13], [16, 18, 3], 68.3, null, [], [0, 0, 0]],
      ['de_mirage', '2026-10-08T19:50:00', 'LOSS', [7, 13], [12, 17, 4], 61.9, null, [], [0, 0, 0]],
      ['de_nuke', '2026-10-07T22:40:00', 'WIN', [13, 9], [21, 13, 2], 88.0, 'ANALYZED', [['CLUTCH_1V1', 1], ['K3', 2]], [1, 0, 0]],
      ['de_inferno', '2026-10-06T20:20:00', 'WIN', [13, 11], [24, 16, 5], 93.7, 'ANALYZED', [['K4', 1], ['NO_SCOPE', 1]], [1, 0, 0]],
      ['de_mirage', '2026-10-05T22:00:00', 'WIN', [13, 8], [20, 12, 3], 84.2, 'ANALYZED', [], [0, 0, 0]],
      ['de_ancient', '2026-10-05T20:30:00', 'LOSS', [10, 13], [15, 19, 6], 70.9, 'FAILED', [], [0, 0, 0]],
      [null, '2026-10-04T21:10:00', 'UNKNOWN', null, null, null, null, [], [0, 0, 0]],
      ['de_mirage', '2026-10-03T19:15:00', 'WIN', [13, 6], [29, 9, 4], 112.6, 'ANALYZED', [['ACE', 2], ['K4', 1], ['CLUTCH_1V5', 1], ['CLUTCH_1V4', 1], ['CLUTCH_1V3', 1], ['K3', 3], ['NO_SCOPE', 1]], [3, 0, 1]],
      ['de_nuke', '2026-10-02T22:45:00', 'LOSS', [12, 14], [17, 20, 2], 72.4, 'ANALYZED', [['SMOKE_KILL', 1]], [0, 0, 0]],
      ['de_inferno', '2026-10-01T21:20:00', 'WIN', [13, 10], [23, 14, 5], 89.9, 'ANALYZED', [['WALLBANG', 1], ['KNIFE_KILL', 1]], [0, 0, 0]],
      ['de_vertigo', '2026-09-30T20:05:00', 'WIN', [13, 12], [18, 16, 7], 76.3, null, [], [0, 0, 0]],
      ['de_mirage', '2026-09-29T22:30:00', 'LOSS', [8, 13], [14, 18, 3], 64.8, 'ANALYZED', [['NINJA_DEFUSE', 1]], [0, 0, 0]],
      ['de_ancient', '2026-09-28T19:40:00', 'WIN', [13, 9], [25, 12, 6], 95.1, 'ANALYZED', [['CLUTCH_1V2', 1]], [0, 0, 0]],
      ['de_anubis', '2026-09-27T21:55:00', 'WIN', [13, 11], [21, 15, 8], 82.7, 'STORED', [], [0, 0, 0]],
      ['de_dust2', '2025-12-28T20:25:00', 'LOSS', [6, 13], [11, 19, 2], 55.0, null, [], [0, 0, 0]],
      ['de_mirage', '2025-12-27T22:10:00', 'WIN', [13, 7], [26, 10, 5], 101.3, 'ANALYZED', [['K3', 1]], [0, 0, 0]],
    ] satisfies MatchRow[]
  ).map((row, index) => playerMatchFixture(index + 1, row)),
  offset: 0,
  limit: 20,
}

export const demoFixture: DemoResponse = {
  demoId: 1,
  matchId: WON_MATCH_ID,
  status: 'ANALYZED',
  error: null,
  errorCode: null,
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
    errorCode: null,
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
