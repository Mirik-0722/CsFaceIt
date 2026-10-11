// API responses for the E2E flow, typed with the frontend's own interfaces. The values mirror the backend test fixtures
// (backend/src/test/resources/faceit): s1mple, ELO 3500, level 10; match 1-aaaa... won 13 : 9 on de_mirage.
// The values are chosen for Playwright's strict locators: `25` is in exactly one stats cell, and `de_mirage` and
// `ELO 3500` appear once on their pages.
import type {
  MatchHistoryResponse,
  MatchResponse,
  MatchStatsResponse,
  PlayerResponse,
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

/** One page of history: a win (13 : 9) and a loss (16 : 14 for the other faction). */
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
