import { test, type Page } from '@playwright/test'
import type { AuthProvidersResponse, MeLimits, MeResponse } from '../src/api/authTypes.ts'
import type { MatchBreakdownResponse } from '../src/api/breakdownTypes.ts'
import type { EditorRound, EditorSource } from '../src/api/editorTypes.ts'
import type { PlayerMatchPageResponse, PlayerOverviewResponse } from '../src/api/overviewTypes.ts'
import type {
  ClipResponse,
  DemoResponse,
  HighlightResponse,
  HighlightType,
  MatchHistoryResponse,
  MatchResponse,
  MatchStatsResponse,
  MatchSummary,
  PlayerAggregateStatsResponse,
  PlayerResponse,
  RecorderStatusResponse,
} from '../src/api/types.ts'
import {
  PLAYER_ID,
  WON_MATCH_ID,
  breakdownFixture,
  clipDetailFixture,
  clipFixture,
  demoFixture,
  emptyBreakdownFixture,
  highlightFixture,
  historyFixture,
  matchFixture,
  matchHighlightsFixture,
  playerFixture,
  playerMatchesFixture,
  playerOverviewFixture,
  playerStatsFixture,
  recorderStatusFixture,
  statsFixture,
  unlinkedBreakdownFixture,
} from './fixtures.ts'

/**
 * A screenshot tool, not a test: it opens the pages of the app in every scenario, at the scenario's widths and
 * languages, and writes a full-page PNG per combination to `shots/<scenario>-<page>-<width>-<language>.png`, to be
 * compared with the design spec by eye. Nothing is asserted. It is skipped unless SHOTS is set:
 *
 *   SHOTS=1 npx playwright test e2e/shots.spec.ts
 *
 * The API is mocked as in search-flow.spec.ts. To photograph more, add a row to PAGES or to SCENARIOS: the loop at
 * the bottom turns the two tables into tests.
 *
 * Every picture is taken as a visitor who asked for less motion sees the page: the landing page then does not turn
 * through its maps by itself, so its pictures are of the first map (Mirage) whenever they are taken.
 */

type Language = 'uz' | 'en'

interface Viewport {
  width: number
  height: number
}

/** What the mocked backend serves; a scenario replaces the parts it needs to. */
interface Backend {
  /** The nickname typed into the search form; the search request is answered only for this one. */
  nickname: string
  player: PlayerResponse
  history: MatchHistoryResponse
  match: MatchResponse
  /** `null`: FACEIT has no stats for the match yet (the backend answers 404 MATCH_NOT_FOUND). */
  stats: MatchStatsResponse | null
  /** The rounds of the match and the figures of its demo analysis; `null`: the request fails (the backend answers 500). */
  breakdown: MatchBreakdownResponse | null
  /** The player's figures over the stored matches. */
  playerStats: PlayerAggregateStatsResponse
  /** The player's stored matches by map, and the player's highlights by kind. */
  overview: PlayerOverviewResponse
  /** The first page of the matches page. */
  playerMatches: PlayerMatchPageResponse
  /** The highlights of the match. The player's own are also the profile's newest six and the highlights page. */
  highlights: HighlightResponse[]
  /** `null`: the match has no demo (the backend answers 404 DEMO_NOT_FOUND). */
  demo: DemoResponse | null
  /**
   * The clips of the match, newest first. The player's own are also the clips of the profile and, for a signed-in
   * visitor with a FACEIT player, the clips page under its tabs; the finished ones are the clips page of everybody
   * else, and each has a page of its own, with the kills of the highlight it was recorded from.
   */
  clips: ClipResponse[]
  recorder: RecorderStatusResponse
  /** What the montage editor of the default player in the default match is made from. */
  editor: EditorSource
  /** The signed-in visitor; `null`: nobody is signed in (the backend answers 204 No Content). */
  me: MeResponse | null
  /** Which ways of signing in the backend has turned on. */
  providers: AuthProvidersResponse
  /** The answers to the writes that bring a demo in, by `METHOD path`; every other write is left unanswered. */
  uploads: [string, Reply][]
}

interface ShotPage {
  name: string
  /** Where the page starts. */
  path: string
  /**
   * Presses of Tab, from the top of the page, that put the focus on an element of the page's own content (the `focus`
   * scenario photographs it). The top bar of a visitor who is not signed in takes six stops (the logo, the clips link,
   * the search, UZ, EN and "Sign in"), and seven on the home page (the logo, the three anchors, UZ, EN and "Sign in":
   * it has no search), so the content starts at the seventh or the eighth: count again when a page gains or loses a
   * focusable element before the one that is photographed.
   */
  tabs: number
  /** Only a signed-in visitor sees it (the account menu): scenarios without one leave it out. */
  signedIn?: true
  /** Photographed only by the scenarios that name it in `pages`: one that photographs every page leaves it out. */
  onRequest?: true
  /** Takes the page from `path` to the state that is photographed, when opening the URL is not enough. */
  open?: (page: Page, backend: Backend) => Promise<void>
}

interface Scenario {
  /** The start of every file name it writes. Two rows may share a name: the width or the language tells them apart. */
  name: string
  /** Replaces parts of the default backend. */
  backend?: Partial<Backend>
  /** The pages it photographs: all of them when left out. */
  pages?: PageName[]
  /** The languages it photographs in: Uzbek only when left out. */
  languages?: Language[]
  /** The viewports it photographs at: the desktop and the phone when left out. */
  viewports?: Viewport[]
  /** The last thing done to the page before the picture. */
  before?: (page: Page, shotPage: ShotPage) => Promise<void>
}

const DESKTOP: Viewport = { width: 1440, height: 900 }
const PHONE: Viewport = { width: 390, height: 844 }
// The narrowest phone the design is held to (all six number columns of a scoreboard have to fit in it).
const SMALL_PHONE: Viewport = { width: 360, height: 780 }

const DEFAULT_VIEWPORTS = [DESKTOP, PHONE]

// The `localStorage` key of the language choice: LOCALE_STORAGE_KEY of src/i18n, repeated here because that module
// needs a DOM to load and this file runs in Node.
const LANGUAGE_KEY = 'csfaceit.lang'

// The clips of the default backend that have a page among PAGES.
const READY_CLIP_ID = 1
const RECORDING_CLIP_ID = 5
const FAILED_CLIP_ID = 2

// The montage editor of the default player in the default match.
const MONTAGE_PATH = `/matches/${WON_MATCH_ID}/montaj?player=${PLAYER_ID}`

// `tabs` is explained on ShotPage; the comment on each row names the element the `focus` scenario lands on.
const PAGES = [
  { name: 'home', path: '/', tabs: 9 }, // the nickname field (after the Steam button; the FACEIT one is not pressable yet)
  { name: 'result', path: '/', open: searchFor, tabs: 11 }, // the link around the player card (after field and button)
  { name: 'player', path: `/players/${PLAYER_ID}`, tabs: 7 }, // the player of the first highlight card
  { name: 'highlights', path: `/players/${PLAYER_ID}/highlights`, tabs: 8 }, // the type filter (after the player card)
  { name: 'matches', path: `/players/${PLAYER_ID}/matches`, tabs: 7 }, // the link to the profile, beside the title
  // the first filter button (after "Manage" and the three section tabs)
  { name: 'match', path: `/matches/${WON_MATCH_ID}`, tabs: 11 },
  // The order of a clip: the dialog that the first "Record clip" button of the match page opens. Its focus picture is
  // of what one Tab reaches from where the dialog put the focus when it opened.
  { name: 'order', path: `/matches/${WON_MATCH_ID}`, open: openClipOrder, tabs: 1 },
  { name: 'clips', path: '/clips', tabs: 7 }, // the first clip card
  { name: 'clip', path: `/clips/${READY_CLIP_ID}`, tabs: 7 }, // the play button of the frame over the video
  { name: 'clip-recording', path: `/clips/${RECORDING_CLIP_ID}`, tabs: 7 }, // the link to the match
  // A failed clip, for the scenario of its owner only (so `tabs` is never used: the `focus` scenario leaves it out).
  { name: 'clip-failed', path: `/clips/${FAILED_CLIP_ID}`, tabs: 0, onRequest: true },
  { name: 'notfound', path: '/there-is-no-such-page', tabs: 7 }, // the link back to the search
  // The sign-in: the dialog that "Sign in" of the top bar opens over the home page. Its focus picture is of what one
  // Tab reaches from where the dialog put the focus (the close button): the Steam button.
  { name: 'signin', path: '/', open: openSignIn, tabs: 1 },
  // The account menu of a signed-in visitor, opened over an inner page (the clips: the line under "Clips" shows).
  { name: 'menu', path: '/clips', open: openAccountMenu, tabs: 1, signedIn: true },
  // The montage editor (plan 7), for the scenarios that name it: empty as it opens without a draft; with a draft of four
  // segments, the second selected and the playhead past two of its kills; the same draft vertical with the intro, the
  // playhead on the intro card; the order of the draft; and a draft that no longer fits the demo.
  { name: 'montage', path: MONTAGE_PATH, tabs: 0, onRequest: true },
  { name: 'montage-edit', path: MONTAGE_PATH, open: openMontageEdit, tabs: 0, onRequest: true },
  { name: 'montage-vertical', path: MONTAGE_PATH, open: openMontageVertical, tabs: 0, onRequest: true },
  { name: 'montage-order', path: MONTAGE_PATH, open: openMontageOrder, tabs: 0, onRequest: true },
  { name: 'montage-stale', path: MONTAGE_PATH, open: openMontageStale, tabs: 0, onRequest: true },
] as const satisfies readonly ShotPage[]

type PageName = (typeof PAGES)[number]['name']

const LONG_NICKNAME = 'ThirtyTwo_Characters_Nickname_01'
const LONG_TEAM_NAMES = [
  'Natus Vincere Academy Under-Twenty Regional Roster',
  'Team_With_An_Unbreakable_Very_Long_Name_2026',
]

/** The highlight of the default match with that id. */
function highlight(id: number): HighlightResponse {
  const found = matchHighlightsFixture.find((candidate) => candidate.id === id)
  if (!found) {
    throw new Error(`No highlight ${id} in the fixtures`)
  }
  return found
}

// One clip in every state a clip can be in, each of another highlight of the default match; the highlights that are
// left have none, so their cards offer to record one.
const DEFAULT_CLIPS: ClipResponse[] = [
  clipFixture(RECORDING_CLIP_ID, highlight(3), 'RECORDING', { progress: 45 }),
  clipFixture(4, highlight(7), 'ENCODING', { progress: 80 }),
  clipFixture(3, highlight(1), 'QUEUED'),
  clipFixture(FAILED_CLIP_ID, highlight(6), 'FAILED', { error: 'The recorder stopped responding', errorCode: 'RECORDER_STOPPED' }),
  clipFixture(READY_CLIP_ID, highlight(5), 'DONE'),
]

/**
 * Ten matches, the newest first: the two of the E2E fixtures (a win and a loss) and eight more, six wins and four
 * losses in all, so that the form strip of the profile has its ten squares. The eight take the ids of the stored
 * matches (`playerMatchesFixture`), so that the profile's history rows find their map, figures and highlight there; the
 * first two are not stored, and show an unknown map.
 */
function tenMatches(): MatchHistoryResponse {
  const results = ['WIN', 'LOSS', 'WIN', 'WIN', 'LOSS', 'LOSS', 'WIN', 'WIN', 'WIN', 'LOSS'] as const
  const items = results.map((result, index): MatchSummary => {
    if (index < historyFixture.items.length) {
      return historyFixture.items[index]
    }
    const startedAt = new Date(Date.parse('2023-11-13T21:00:00Z') - index * 24 * 60 * 60 * 1000)
    return {
      matchId: playerMatchesFixture.items[index]?.matchId ?? `1-form-${index}`,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date(startedAt.getTime() + 45 * 60 * 1000).toISOString(),
      result,
      // The score comes in faction order, the winner has more rounds.
      score: result === 'WIN' ? { faction1: 13, faction2: 6 + index } : { faction1: 8 + index, faction2: 13 },
    }
  })
  return { items, offset: 0, limit: 20 }
}

// The wins that differ from the E2E fixture's, by map (see DEFAULT_OVERVIEW).
const WINS_BY_MAP: Record<string, number> = { de_mirage: 4, de_inferno: 1 }

/**
 * The E2E fixture's maps with one share of wins under 50%, so that the maps table shows a red bar as well as the green
 * ones (Mirage 80%, Inferno 33%, Ancient 50%, Nuke 100%, Dust2 0%: no fill). One win moves from Inferno to Mirage, so
 * the maps still add up to the fixture's 7 wins of 12 matches (the "G'alaba ulushi" tile's 58.3%).
 */
const DEFAULT_OVERVIEW: PlayerOverviewResponse = {
  ...playerOverviewFixture,
  maps: playerOverviewFixture.maps.map((map) => ({ ...map, wins: WINS_BY_MAP[map.mapName] ?? map.wins })),
}

// The made-up demo behind the montage editor: 64 ticks a second, round N starting at tick 1000 + (N - 1) * 7000 and
// lasting 100 s.
const TICK_RATE = 64

function roundStart(number: number): number {
  return 1000 + (number - 1) * 7000
}

/** A tick of round `number`, `seconds` after its start. */
function tickOf(number: number, seconds: number): number {
  return roundStart(number) + seconds * TICK_RATE
}

type MadeUpKill = [seconds: number, weapon: string, victim: string, marks?: ('hs' | 'wall' | 'noscope' | 'smoke')[]]

function editorRound(number: number, side: 'CT' | 'T' | null, kills: MadeUpKill[]): EditorRound {
  return {
    number,
    startTick: roundStart(number),
    endTick: roundStart(number) + 100 * TICK_RATE,
    side,
    kills: kills.map(([seconds, weapon, victimNickname, marks = []]) => ({
      tick: tickOf(number, seconds),
      weapon,
      headshot: marks.includes('hs'),
      wallbang: marks.includes('wall'),
      noscope: marks.includes('noscope'),
      throughSmoke: marks.includes('smoke'),
      victimNickname,
    })),
  }
}

/** Six rounds with kills of the default player, an ace among them, and the highlights of four of them. */
const EDITOR_SOURCE: EditorSource = {
  matchId: WON_MATCH_ID,
  mapName: 'de_mirage',
  tickRate: TICK_RATE,
  player: { playerId: PLAYER_ID, nickname: playerFixture.nickname },
  rounds: [
    editorRound(2, 'CT', [
      [24, 'm4a1_silencer', 'playerB2', ['hs']],
      [31, 'm4a1_silencer', 'playerB4'],
    ]),
    editorRound(5, 'CT', [
      [41, 'awp', 'playerB1'],
      [47, 'awp', 'playerB3', ['smoke']],
    ]),
    editorRound(7, 'CT', [
      [15, 'm4a1_silencer', 'playerB5', ['hs']],
      [17, 'm4a1_silencer', 'playerB2', ['wall']],
      [21, 'm4a1_silencer', 'playerB1', ['hs']],
    ]),
    editorRound(14, 'T', [
      [30, 'ak47', 'playerB1'],
      [33, 'ak47', 'playerB4', ['hs']],
      [34, 'ak47', 'playerB2', ['hs']],
      [52, 'ak47', 'playerB5'],
      [58, 'deagle', 'playerB3', ['hs']],
    ]),
    editorRound(18, 'T', [[12, 'awp', 'playerB4', ['noscope']]]),
    editorRound(21, null, [
      [72, 'ak47', 'playerB2'],
      [80, 'knife', 'ThirtyTwo_Characters_Nickname_01'],
    ]),
  ],
  highlights: [
    { id: 101, type: 'SMOKE_KILL', roundNumber: 5, tickStart: tickOf(5, 44), tickEnd: tickOf(5, 49) },
    { id: 102, type: 'K3', roundNumber: 7, tickStart: tickOf(7, 12), tickEnd: tickOf(7, 23) },
    { id: 103, type: 'ACE', roundNumber: 14, tickStart: tickOf(14, 27), tickEnd: tickOf(14, 60) },
    { id: 104, type: 'NO_SCOPE', roundNumber: 18, tickStart: tickOf(18, 9), tickEnd: tickOf(18, 14) },
  ],
  limits: {
    preSeconds: 3,
    postSeconds: 2,
    maxSegmentSeconds: 60,
    maxDurationSeconds: 300,
    maxSegments: 30,
    qualities: ['720p', '1080p'],
    aspects: ['16:9', '9:16'],
    titleMaxLength: 60,
    musicTracks: [
      { id: 'night-drive', name: 'Night Drive' },
      { id: 'low-orbit', name: 'Low Orbit' },
      { id: 'paper-tigers', name: 'Paper Tigers' },
    ],
  },
}

/**
 * A draft of four segments as the editor keeps it (`serializeDraft` of src/lib/montage.ts, which needs a DOM to load):
 * the ace, the triple kill in slow motion, the two AWP kills and the no-scope, with a title and music.
 */
const MONTAGE_DRAFT = {
  version: 1,
  segments: [
    { startTick: tickOf(14, 27), endTick: tickOf(14, 36), slowMo: false },
    { startTick: tickOf(7, 12), endTick: tickOf(7, 23), slowMo: true },
    { startTick: tickOf(5, 38), endTick: tickOf(5, 49), slowMo: false },
    { startTick: tickOf(18, 9), endTick: tickOf(18, 14), slowMo: false },
  ],
  title: 'Mirage night, ace on T side',
  intro: false,
  musicTrack: 'night-drive',
  quality: '1080p',
  aspect: '16:9',
}

const VERTICAL_DRAFT = { ...MONTAGE_DRAFT, intro: true, aspect: '9:16' }

const DEFAULT_BACKEND: Backend = {
  nickname: 's1mple',
  player: playerFixture,
  history: tenMatches(),
  match: matchFixture,
  stats: statsFixture,
  breakdown: breakdownFixture,
  playerStats: playerStatsFixture,
  overview: DEFAULT_OVERVIEW,
  playerMatches: playerMatchesFixture,
  highlights: matchHighlightsFixture,
  demo: demoFixture,
  clips: DEFAULT_CLIPS,
  recorder: recorderStatusFixture,
  editor: EDITOR_SOURCE,
  me: null,
  providers: { steam: true, faceit: false },
  uploads: [],
}

/** A visitor signed in with Steam whose FACEIT player was found: the nav has the player's pages. */
const LINKED_USER: MeResponse = {
  id: 1,
  nickname: playerFixture.nickname,
  avatarUrl: null,
  role: 'USER',
  steamId: '76561198000000001',
  playerId: PLAYER_ID,
}

/** A visitor signed in with Steam for whom FACEIT has no player: no player pages, and the notice under the top bar. */
const UNLINKED_USER: MeResponse = {
  ...LINKED_USER,
  nickname: 'Steam 000001',
  steamId: '76561198000000002',
  playerId: null,
}

/**
 * What is left of a day's limits: `clipOrders` of the five clip orders, every demo import, and every demo upload or
 * `demoUploads` of the ten.
 */
function limitsWith(clipOrders: number, demoUploads = 10): MeLimits {
  return {
    demoUploads: { limit: 10, remaining: demoUploads, resetsAt: demoUploads < 10 ? '2023-11-15T06:30:00Z' : null },
    demoImports: { limit: 20, remaining: 20, resetsAt: null },
    // A fixed moment, never "today" when the pictures are taken: the sentence then names the day as well as the hour.
    clipOrders: { limit: 5, remaining: clipOrders, resetsAt: clipOrders < 5 ? '2023-11-15T06:30:00Z' : null },
  }
}

/** A signed-in player of the default match (its first roster has the player), with three clip orders left today. */
const MEMBER: MeResponse = { ...LINKED_USER, limits: limitsWith(3) }

/** A signed-in visitor whose FACEIT player is in neither roster of the default match. */
const OUTSIDER: MeResponse = {
  ...LINKED_USER,
  id: 2,
  nickname: 'outsider_01',
  steamId: '76561198000000003',
  playerId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  limits: limitsWith(5),
}

/** A player without a stored match: every figure is a dash. */
const NO_PLAYER_STATS: PlayerAggregateStatsResponse = {
  playerId: PLAYER_ID,
  matches: 0,
  analyzedMatches: 0,
  winRate: null,
  kd: 0,
  hsPercent: 0,
  adr: null,
  kast: null,
  entryKillsPerMatch: null,
  tradeKillsPerMatch: null,
  clutchPercent: null,
  clutchAttempts: 0,
  clutchWins: 0,
}

const OWNER = { playerId: PLAYER_ID, nickname: playerFixture.nickname }

// What real highlights hold that the default ones do not.
const EDGE_HIGHLIGHTS: HighlightResponse[] = [
  // A player the backend knows only from the demo (no profile to link to) whose side is unknown; a grenade kill.
  highlightFixture(21, 'K3', { playerId: 'steam:76561198000000001', nickname: 'demo_only_player' }, 2, null, [
    [20, 'mp9'],
    [26, 'mp9', true],
    [61, 'hegrenade'],
  ]),
  // A clutch won without a kill in its window, in a match without a map or a start time.
  { ...highlightFixture(22, 'CLUTCH_1V1', OWNER, 6, 'T', []), mapName: null, startedAt: null },
  // A weapon the list of names does not have keeps its raw name.
  highlightFixture(23, 'WALLBANG', OWNER, 8, 'CT', [[40, 'weapon_of_a_later_update']]),
  // Kills in the first and the last second of the round: the window is cut at the ends of the track.
  highlightFixture(24, 'K3', OWNER, 12, 'CT', [
    [1, 'ak47'],
    [50, 'ak47'],
    [99, 'ak47', true],
  ]),
]

// What real clips hold that the default ones do not. Their highlights are those of EDGE_HIGHLIGHTS.
const EDGE_CLIPS: ClipResponse[] = [
  // A compilation: no highlight behind it, so no type, round or tick, and minutes long.
  clipFixture(31, EDGE_HIGHLIGHTS[3], 'DONE', {
    kind: 'COMPILATION',
    highlightType: null,
    roundNumber: null,
    tickStart: null,
    quality: '720p',
    durationMs: 137_000,
    sizeBytes: 171_000_000,
  }),
  // Far back in a long queue, of a player who has no profile.
  clipFixture(32, EDGE_HIGHLIGHTS[0], 'QUEUED', { queuePosition: 12 }),
  // A failure with a long reason, of a match without a map.
  clipFixture(33, EDGE_HIGHLIGHTS[1], 'FAILED', {
    error: 'This demo was recorded on a game version the recorder can no longer play',
  }),
  clipFixture(34, EDGE_HIGHLIGHTS[2], 'UPLOADING', { progress: 100 }),
]

/** A highlight of the player on a map of its own (the default match is on Mirage only), for the clips below. */
function ownHighlight(id: number, type: HighlightType, mapName: string, roundNumber: number): HighlightResponse {
  return { ...highlightFixture(id, type, OWNER, roundNumber, 'CT', [[40, 'ak47']]), mapName }
}

// The clips of the signed-in player as the design's page of clips draws them, newest first: eight, in five states, on
// four maps. Under the tabs: 8 in all, 3 in progress (recording, queued, encoding), 4 ready, 1 failed.
const OWN_CLIPS: ClipResponse[] = [
  clipFixture(58, ownHighlight(61, 'CLUTCH_1V3', 'de_mirage', 21), 'RECORDING', { progress: 45 }),
  clipFixture(57, ownHighlight(62, 'CLUTCH_1V1', 'de_mirage', 11), 'QUEUED', { queuePosition: 2 }),
  clipFixture(56, ownHighlight(63, 'K4', 'de_ancient', 7), 'ENCODING', { progress: 80 }),
  clipFixture(55, ownHighlight(64, 'K3', 'de_ancient', 13), 'DONE', {
    kind: 'COMPILATION',
    highlightType: null,
    roundNumber: null,
    tickStart: null,
    durationMs: 137_000,
    sizeBytes: 171_000_000,
  }),
  clipFixture(54, ownHighlight(65, 'ACE', 'de_mirage', 14), 'DONE', { durationMs: 16_000, sizeBytes: 22_440_000 }),
  clipFixture(53, ownHighlight(66, 'K4', 'de_inferno', 9), 'DONE', {
    quality: '720p',
    durationMs: 15_000,
    sizeBytes: 11_740_000,
  }),
  clipFixture(52, ownHighlight(67, 'K3', 'de_nuke', 18), 'DONE', { durationMs: 12_000, sizeBytes: 15_830_000 }),
  clipFixture(51, ownHighlight(68, 'NO_SCOPE', 'de_inferno', 4), 'FAILED', { error: 'The recorder stopped responding', errorCode: 'RECORDER_STOPPED' }),
]

// A 32-character nickname and team names longer than 32 characters (one with spaces, one without).
const LONG_BACKEND: Partial<Backend> = {
  nickname: LONG_NICKNAME,
  player: { ...playerFixture, nickname: LONG_NICKNAME },
  match: {
    ...matchFixture,
    teams: matchFixture.teams.map((team, index) => ({ ...team, name: LONG_TEAM_NAMES[index] })),
  },
  stats: {
    ...statsFixture,
    teams: statsFixture.teams.map((team, index) => ({
      ...team,
      name: LONG_TEAM_NAMES[index],
      // The top row of the first team carries the long nickname.
      players: team.players.map((player, row) =>
        index === 0 && row === 0 ? { ...player, nickname: LONG_NICKNAME } : player,
      ),
    })),
  },
  highlights: matchHighlightsFixture.map((highlight) =>
    highlight.playerId === PLAYER_ID ? { ...highlight, nickname: LONG_NICKNAME } : highlight,
  ),
  clips: DEFAULT_CLIPS.map((clip) => (clip.playerId === PLAYER_ID ? { ...clip, nickname: LONG_NICKNAME } : clip)),
}

/**
 * A full page of history, 20 rows, so that the page offers "Load more". Most rows are wins and losses; one has the
 * result UNKNOWN (it could not be told from the history item) and one has no score for either faction.
 */
function edgeHistory(): MatchHistoryResponse {
  const DAY = 24 * 60 * 60 * 1000
  const latest = Date.parse('2026-10-10T20:00:00Z')
  const items = Array.from({ length: 20 }, (_, index): MatchSummary => {
    const startedAt = new Date(latest - index * DAY)
    const lost = index % 3 === 2
    return {
      matchId: `1-edge-${index}`,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date(startedAt.getTime() + 45 * 60 * 1000).toISOString(),
      result: lost ? 'LOSS' : 'WIN',
      // The score comes in faction order, the winner has more rounds: 11 : 13 is the player's loss.
      score: lost ? { faction1: 11, faction2: 13 } : { faction1: 13, faction2: 7 + (index % 5) },
    }
  })
  items[4] = { ...items[4], result: 'UNKNOWN' }
  items[9] = { ...items[9], score: {} }
  return { items, offset: 0, limit: 20 }
}

/**
 * The matches of the default list under FACEIT-style ids (`1-` and a UUID, the last group counting the rows from 1), so
 * that a demo file named for one of them finds its row: the sixth has no demo, the fourth is parsed, the last-but-two
 * is stored.
 */
function withFaceitIds(page: PlayerMatchPageResponse): PlayerMatchPageResponse {
  return {
    ...page,
    items: page.items.map((match, index) => ({
      ...match,
      matchId: faceitMatchId(index + 1),
    })),
  }
}

function faceitMatchId(row: number): string {
  return `1-aaaaaaaa-bbbb-cccc-dddd-${String(row).padStart(12, '0')}`
}

/** The upload of a demo file to the match of a row, answered by `reply`. */
function uploadTo(row: number, reply: Reply): [string, Reply] {
  return [`POST /api/v1/matches/${faceitMatchId(row)}/demo/upload`, reply]
}

/**
 * Drops a file with that name on the page, the way the browser tells it: the three drag events with the file in them
 * (only the first one, when `holding`, so that the picture is of the page while the file is over it).
 */
function dropFile(name: string, holding = false) {
  const types = holding ? ['dragenter'] : ['dragenter', 'dragover', 'drop']
  return async (page: Page) => {
    await page.evaluate(`(() => {
      const data = new DataTransfer()
      data.items.add(new File(['demo'], ${JSON.stringify(name)}))
      for (const type of ${JSON.stringify(types)}) {
        document.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }))
      }
    })()`)
    // Not `settle`: an upload that is not answered keeps the network from going quiet.
    await page.waitForTimeout(400)
  }
}

/** The clips of the signed-in player: the ones that were ordered by them, so that their cards have the actions. */
const MINE_CLIPS = OWN_CLIPS.map((clip) => ({ ...clip, mine: true }))

const SCENARIOS: Scenario[] = [
  { name: 'default', languages: ['uz', 'en'] },
  // The same pages once more, in Uzbek, on the narrowest phone.
  { name: 'default', viewports: [SMALL_PHONE] },
  {
    name: 'long',
    pages: ['result', 'player', 'highlights', 'matches', 'match'],
    backend: LONG_BACKEND,
  },
  {
    // A player without CS2 data, without a single match, a stored figure or a highlight.
    name: 'empty',
    pages: ['result', 'player', 'highlights', 'matches'],
    backend: {
      player: { ...playerFixture, avatar: null, country: null, elo: null, level: null },
      history: { items: [], offset: 0, limit: 20 },
      playerStats: NO_PLAYER_STATS,
      overview: { playerId: PLAYER_ID, maps: [], highlights: [] },
      playerMatches: { items: [], offset: 0, limit: 20 },
      highlights: [],
      clips: [],
    },
  },
  // No clip yet and no recorder ever seen: every card offers to record, and the clips page is empty.
  {
    name: 'noclips',
    pages: ['match', 'clips'],
    backend: { clips: [], recorder: { online: false, lastSeenAt: null, queued: 0, active: 0 } },
  },
  // The recording PC went away while clips were waiting.
  {
    name: 'offline',
    pages: ['matches', 'match', 'order', 'clips'],
    backend: {
      clips: DEFAULT_CLIPS.filter((clip) => clip.status === 'QUEUED' || clip.status === 'DONE'),
      recorder: { online: false, lastSeenAt: '2023-11-14T21:00:00Z', queued: 1, active: 0 },
    },
  },
  {
    // A match that is still being played: FACEIT has published neither the map nor the times nor a winner, no stats;
    // there is no demo and so no highlight.
    name: 'live',
    pages: ['match'],
    backend: {
      match: { ...matchFixture, mapName: null, startedAt: null, finishedAt: null, winner: null, status: 'ONGOING' },
      stats: null,
      breakdown: emptyBreakdownFixture,
      demo: null,
      highlights: [],
      clips: [],
    },
  },
  {
    // What real data holds that the default does not: a history of 20 rows (with "Load more", an UNKNOWN result and a
    // row without a score), a match whose second team has an empty roster, stored matches without an analyzed demo,
    // a demo whose analysis failed, and the highlights of EDGE_HIGHLIGHTS.
    name: 'edge',
    pages: ['player', 'highlights', 'match', 'clips'],
    backend: {
      history: edgeHistory(),
      match: { ...matchFixture, teams: [matchFixture.teams[0], { ...matchFixture.teams[1], players: [] }] },
      stats: { ...statsFixture, teams: [statsFixture.teams[0], { ...statsFixture.teams[1], players: [] }] },
      playerStats: { ...NO_PLAYER_STATS, matches: 7, winRate: 42.9, kd: 0.94, hsPercent: 38.5, adr: 71.3 },
      highlights: EDGE_HIGHLIGHTS,
      demo: { ...demoFixture, status: 'PARSED', error: 'Analysis failed: round 7 has no kill rows to order (IllegalStateException)' },
      clips: EDGE_CLIPS,
    },
  },
  // Signed in with a FACEIT player: the home page without the sign-in buttons, the nav with the player's pages, the
  // account menu (on the clips, so that the line under "Clips" shows), the player's own page.
  { name: 'signedin', pages: ['home', 'player', 'clips', 'menu'], backend: { me: LINKED_USER } },
  // Signed in, but FACEIT has no player for the Steam account: the notice, the short nav and the short menu.
  { name: 'unlinked', pages: ['home', 'clips', 'menu'], backend: { me: UNLINKED_USER } },
  // The page of clips of a signed-in player with a FACEIT player: every state under the tabs by state (the design's
  // screen 5), then the tab with nothing in it (no clip has failed), then the page as a visitor sees it.
  { name: 'myclips', pages: ['clips'], backend: { me: LINKED_USER, clips: OWN_CLIPS } },
  {
    name: 'myclips-empty',
    pages: ['clips'],
    backend: { me: LINKED_USER, clips: OWN_CLIPS.filter((clip) => clip.status !== 'FAILED') },
    before: openLastTab,
  },
  { name: 'visitor', pages: ['clips'], backend: { me: null, clips: OWN_CLIPS } },
  // The landing page with another map pressed in its strip: the backdrop and the corner label of the sample frame are
  // that map's. Nuke has the brightest sky of the eight, so it is the one to judge the veil by.
  { name: 'map', pages: ['home'], before: pressOtherMap },
  // FACEIT turned on in the backend: its sign-in button is a button now, in the hero and in the dialog.
  { name: 'faceit', pages: ['home', 'signin'], backend: { providers: { steam: true, faceit: true } } },
  // The players of the demo are not linked to the roster: the strip has one row, the scoreboard no analysis columns.
  { name: 'unlinked-demo', pages: ['match'], backend: { breakdown: unlinkedBreakdownFixture } },
  // The demo has not been analyzed: no strip, no sides, no analysis columns.
  { name: 'nobreakdown', pages: ['match'], backend: { breakdown: emptyBreakdownFixture } },
  // The breakdown cannot be had: the page is as without one, and nothing else on it fails.
  { name: 'breakdown-failed', pages: ['match'], backend: { breakdown: null } },
  // Every match is on the first page: no "Show more", and the counts of the filters are exact (no "+").
  {
    name: 'short',
    pages: ['matches'],
    backend: { playerMatches: { ...playerMatchesFixture, items: playerMatchesFixture.items.slice(0, 8) } },
  },
  // The demo panel opened: the admin key field and the three requests it guards.
  { name: 'manage', pages: ['match'], before: openDemoControls },
  // A demo that FACEIT did not let the site download: the explanation in the language of the page and the link to the
  // match's room on FACEIT, in place of the backend's English sentence. The controls are open by themselves (nothing is
  // pressed here), because the sentence sends the visitor to the upload below it.
  {
    name: 'noaccess',
    pages: ['match'],
    languages: ['uz', 'en'],
    backend: {
      demo: {
        ...demoFixture,
        status: 'FAILED',
        error:
          "Demo download rejected: FACEIT did not let this site download the demo. Download it from the match's room on FACEIT and upload the .dem file manually.",
        errorCode: 'DOWNLOAD_NEEDS_ACCESS',
      },
    },
  },
  // A demo whose import failed on every attempt: the explanation in the language of the page, in place of the backend's
  // English sentence, and the controls open by themselves, because it sends the visitor to the upload below it.
  {
    name: 'importfailed',
    pages: ['match'],
    languages: ['uz', 'en'],
    backend: {
      demo: {
        ...demoFixture,
        status: 'FAILED',
        error: 'Importing the demo failed after 3 attempts',
        errorCode: 'IMPORT_FAILED',
      },
    },
  },
  // Who may write what (plan 6b). A visitor who is not signed in: the demo panel opened, with the admin key field, and
  // the order dialog with the field and the line that says how to do without it.
  { name: 'session-visitor', pages: ['match', 'order'], languages: ['uz', 'en'], before: openDemoControlsOnMatch },
  // A signed-in player of the match whose demo is on its way: the line of stages under the status, and the controls
  // without a key field (with the quiet switch to it).
  {
    name: 'session-member',
    pages: ['match'],
    languages: ['uz', 'en'],
    backend: {
      me: MEMBER,
      demo: { ...demoFixture, status: 'STORED' },
      breakdown: emptyBreakdownFixture,
      highlights: [],
      clips: [],
    },
    before: openDemoControlsOnMatch,
  },
  // The same player on a match without a demo: the controls are open by themselves (nothing is pressed here).
  {
    name: 'session-member-nodemo',
    pages: ['match'],
    backend: { me: MEMBER, demo: null, breakdown: emptyBreakdownFixture, highlights: [], clips: [] },
  },
  // The same player on a match without a demo, with no demo upload left today: the upload is off, and the panel says
  // when the next is possible; the import is still offered.
  {
    name: 'session-nouploads',
    pages: ['match'],
    languages: ['uz', 'en'],
    backend: {
      me: { ...MEMBER, limits: limitsWith(3, 0) },
      demo: null,
      breakdown: emptyBreakdownFixture,
      highlights: [],
      clips: [],
    },
  },
  // The same player ordering the clip of an own highlight (no clip exists, so the first card is the player's): no key
  // field, and three of five orders left.
  { name: 'session-member', pages: ['order'], languages: ['uz', 'en'], backend: { me: MEMBER, clips: [] } },
  // A signed-in visitor who did not play in the match: the reason in the opened demo panel, with the switch to the key
  // field, and no card that offers to record a clip (none is the visitor's), so there is no order dialog to open.
  {
    name: 'session-outsider',
    pages: ['match'],
    languages: ['uz', 'en'],
    backend: { me: OUTSIDER },
    before: openDemoControlsOnMatch,
  },
  // Signed in, but FACEIT has no player for the Steam account: the demo panel says so, and what to do about it.
  {
    name: 'session-unlinked',
    pages: ['match'],
    languages: ['uz', 'en'],
    backend: { me: UNLINKED_USER },
    before: openDemoControlsOnMatch,
  },
  // A player who has used up the day's clip orders: the button is off, and the dialog says when the next is possible.
  {
    name: 'session-nolimit',
    pages: ['order'],
    languages: ['uz', 'en'],
    backend: { me: { ...MEMBER, limits: limitsWith(0) }, clips: [] },
  },
  // The page of a failed clip as whoever ordered it sees it: "Try again" and "Delete" without the admin key.
  {
    name: 'session-owner',
    pages: ['clip-failed'],
    languages: ['uz', 'en'],
    backend: {
      me: MEMBER,
      clips: [
        clipFixture(FAILED_CLIP_ID, highlight(8), 'FAILED', {
          error: 'The recorder stopped responding',
          errorCode: 'RECORDER_STOPPED',
          mine: true,
        }),
        clipFixture(READY_CLIP_ID, highlight(5), 'DONE', { mine: true }),
      ],
    },
  },
  // Plan 6b, bringing demos in. A signed-in player on the page of their own matches: the upload box beside the rows,
  // "Upload a demo" on the rows that have none, the stage bars of the demos that are on their way.
  {
    name: 'bring',
    pages: ['matches'],
    languages: ['uz', 'en'],
    backend: { me: MEMBER, playerMatches: withFaceitIds(playerMatchesFixture) },
  },
  // A file that was dropped whose name has no match id: why it is not uploaded, and where the way out is.
  {
    name: 'bring-noid',
    pages: ['matches'],
    languages: ['uz', 'en'],
    backend: { me: MEMBER, playerMatches: withFaceitIds(playerMatchesFixture) },
    before: (page) => dropFile('final_demo_v2.dem')(page),
  },
  // A file named for the sixth row (no demo) that is still going out, and one for the fourth (parsed already), which
  // the page refuses before sending anything.
  {
    name: 'bring-sending',
    pages: ['matches'],
    languages: ['uz', 'en'],
    backend: {
      me: MEMBER,
      playerMatches: withFaceitIds(playerMatchesFixture),
      uploads: [uploadTo(5, { body: {}, hang: true })],
    },
    before: async (page) => {
      await dropFile(`${faceitMatchId(5)}-1-1.dem.zst`)(page)
      await dropFile(`${faceitMatchId(4)}-1-1.dem`)(page)
    },
  },
  // The same, with the backend refusing the upload: the day's limit is used up (429 with the moment it frees up).
  {
    name: 'bring-refused',
    pages: ['matches'],
    languages: ['uz'],
    backend: {
      me: MEMBER,
      playerMatches: withFaceitIds(playerMatchesFixture),
      uploads: [
        uploadTo(5, {
          status: 429,
          body: { code: 'UPLOAD_LIMIT_REACHED', message: 'Limit reached', retryAt: '2023-11-15T06:30:00Z' },
        }),
      ],
    },
    before: dropFile(`${faceitMatchId(5)}-1-1.dem.zst`),
  },
  // A file held over the page: the frame that says where to let it go.
  {
    name: 'bring-drag',
    pages: ['matches'],
    languages: ['uz'],
    viewports: [DESKTOP],
    backend: { me: MEMBER, playerMatches: withFaceitIds(playerMatchesFixture) },
    before: dropFile('whatever.dem', true),
  },
  // The player's own clips with their actions: "Cancel" on the queued one, "Try again" on the failed one, the download
  // on the ready ones.
  { name: 'bring-clips', pages: ['clips'], languages: ['uz', 'en'], backend: { me: MEMBER, clips: MINE_CLIPS } },
  // The first scoreboard scrolled to its right end, on a phone: the player column and the team header stay in place.
  // The default scoreboard fits in 390px and has nothing to scroll; the one with the 32-character nickname overflows.
  { name: 'scrolled-long', pages: ['match'], viewports: [PHONE], backend: LONG_BACKEND, before: scrollScoreboard },
  // The montage editor (plan 7) as a visitor who is not signed in sees it: the order is "Sign in" or the admin key.
  {
    name: 'montage',
    pages: ['montage', 'montage-edit', 'montage-vertical', 'montage-stale'],
    languages: ['uz', 'en'],
  },
  // The same editor as the signed-in player whose kills they are: "Record the montage", and its order dialog.
  { name: 'montage-member', pages: ['montage-edit', 'montage-order'], languages: ['uz', 'en'], backend: { me: MEMBER } },
  // Where the focus ring is on each page's content: the element that the page's `tabs` presses of Tab reach.
  { name: 'focus', before: pressTab },
]

/**
 * The `uz`/`en` choice as the app reads it: the key set in `localStorage` before the page's own scripts run. It is set
 * by a script of the page, not by a storage state, so that it reaches whichever origin the tool runs on (the one of
 * the `baseURL` of the config): a state names its origin, and a tool on another port would photograph Uzbek only.
 * (A script, not a function: this project has no DOM types to write one in.)
 */
async function setLanguage(page: Page, language: Language) {
  await page.addInitScript(`localStorage.setItem(${JSON.stringify(LANGUAGE_KEY)}, ${JSON.stringify(language)})`)
}

interface Reply {
  status?: number
  body: unknown
  /** The request is never answered (an upload that is still going when the picture is taken). */
  hang?: true
}

/** The highlight a clip was recorded from: the same player, type, round and start, as the app itself matches them. */
function highlightOf(clip: ClipResponse, highlights: HighlightResponse[]): HighlightResponse | undefined {
  return highlights.find(
    (candidate) =>
      candidate.playerId === clip.playerId &&
      candidate.type === clip.highlightType &&
      candidate.roundNumber === clip.roundNumber &&
      candidate.tickStart === clip.tickStart,
  )
}

/** Every API call the pages make, keyed by method, path and query as the app sends them. */
function answersFor(backend: Backend): Map<string, Reply> {
  const own = backend.highlights.filter((highlight) => highlight.playerId === PLAYER_ID)
  const ownClips = backend.clips.filter((clip) => clip.playerId === PLAYER_ID)
  const finishedClips = backend.clips.filter((clip) => clip.status === 'DONE')
  return new Map<string, Reply>([
    [`GET /api/v1/matches/${WON_MATCH_ID}/clips`, { body: backend.clips }],
    [`GET /api/v1/players/${PLAYER_ID}/clips?offset=0&limit=12`, { body: { items: ownClips, offset: 0, limit: 12 } }],
    ['GET /api/v1/clips?offset=0&limit=12', { body: { items: finishedClips, offset: 0, limit: 12 } }],
    ['GET /api/v1/recorder/status', { body: backend.recorder }],
    [`GET /api/v1/matches/${WON_MATCH_ID}/editor?playerId=${PLAYER_ID}`, { body: backend.editor }],
    [
      'GET /api/v1/auth/me',
      backend.me
        ? { body: backend.me }
        : { status: 204, body: undefined },
    ],
    ['GET /api/v1/auth/providers', { body: backend.providers }],
    // The sync that the page of one's own matches asks for when it opens: nothing was queued.
    ['POST /api/v1/matches/sync', { status: 202, body: { enabled: true, queued: 0 } }],
    ...backend.uploads,
    ...backend.clips.map((clip): [string, Reply] => {
      const source = highlightOf(clip, backend.highlights)
      return [`GET /api/v1/clips/${clip.id}`, { body: source ? clipDetailFixture(clip, source) : clip }]
    }),
    // There is no video file behind a mocked clip: the frame over the player is the picture, and a started video fails.
    ...finishedClips.map((clip): [string, Reply] => [
      `GET /api/v1/clips/${clip.id}/video`,
      { status: 404, body: { code: 'CLIP_NOT_FOUND', message: 'Clip not found' } },
    ]),
    [`GET /api/v1/players?nickname=${backend.nickname}`, { body: backend.player }],
    [`GET /api/v1/players/${PLAYER_ID}`, { body: backend.player }],
    [`GET /api/v1/players/${PLAYER_ID}/history?offset=0&limit=20`, { body: backend.history }],
    [`GET /api/v1/players/${PLAYER_ID}/stats`, { body: backend.playerStats }],
    [`GET /api/v1/players/${PLAYER_ID}/overview`, { body: backend.overview }],
    [`GET /api/v1/players/${PLAYER_ID}/matches?offset=0&limit=20`, { body: backend.playerMatches }],
    [
      `GET /api/v1/players/${PLAYER_ID}/highlights?offset=0&limit=6`,
      { body: { items: own.slice(0, 6), offset: 0, limit: 6 } },
    ],
    [`GET /api/v1/players/${PLAYER_ID}/highlights?offset=0&limit=50`, { body: { items: own, offset: 0, limit: 50 } }],
    [
      `GET /api/v1/matches/${WON_MATCH_ID}/demo`,
      backend.demo
        ? { body: backend.demo }
        : { status: 404, body: { code: 'DEMO_NOT_FOUND', message: 'Demo not found' } },
    ],
    [`GET /api/v1/matches/${WON_MATCH_ID}/highlights`, { body: backend.highlights }],
    [`GET /api/v1/matches/${WON_MATCH_ID}`, { body: backend.match }],
    [
      `GET /api/v1/matches/${WON_MATCH_ID}/stats`,
      backend.stats
        ? { body: backend.stats }
        : { status: 404, body: { code: 'MATCH_NOT_FOUND', message: 'Match not found' } },
    ],
    [
      `GET /api/v1/matches/${WON_MATCH_ID}/breakdown`,
      backend.breakdown
        ? { body: backend.breakdown }
        : { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Internal error' } },
    ],
  ])
}

async function mockApi(page: Page, answers: Map<string, Reply>) {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const url = new URL(route.request().url())
      const key = `${route.request().method()} ${url.pathname}${url.search}`
      const reply = answers.get(key)
      if (reply?.hang) {
        return
      }
      if (reply) {
        await route.fulfill({ status: reply.status ?? 200, json: reply.body })
      } else {
        // Not a failure of the tool, but the picture would show an error where the page was meant to have data.
        console.warn(`shots: no mocked answer for ${key}`)
        await route.abort()
      }
    },
  )
}

/** Waits until the page has stopped changing: requests answered, skeletons gone, fonts loaded. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.locator('[data-slot="skeleton"]').first().waitFor({ state: 'detached' })
  await page.evaluate('document.fonts.ready.then(() => undefined)')
}

/** The home page after a search: types the nickname and waits for the player card. */
async function searchFor(page: Page, backend: Backend) {
  const input = page.locator('input[name="nickname"]')
  await input.fill(backend.nickname)
  await input.press('Enter')
  await page.locator('a[href^="/players/"]').waitFor()
}

/** Presses Tab as often as the page's `tabs` say, from the top of the page, or from where an open dialog put the focus. */
async function pressTab(page: Page, { tabs }: ShotPage) {
  // A click in the top-left corner (nothing to click there) makes Tab start from the top of the page, whatever the
  // page did before: the search leaves the focus in its form. An open dialog holds the focus itself, and the click
  // would land outside it and close it.
  if ((await page.locator('[data-slot="dialog-content"]').count()) === 0) {
    await page.mouse.click(1, 1)
  }
  for (let press = 0; press < tabs; press++) {
    await page.keyboard.press('Tab')
  }
}

/** Opens the order of the first highlight that has no clip yet: the first filled button among the highlight cards. */
async function openClipOrder(page: Page) {
  await page.locator('article button[data-slot="button"]').first().click()
  await page.locator('[data-slot="dialog-content"]').waitFor()
}

/** Opens the sign-in dialog: the one button of the top bar that is not a language button. */
async function openSignIn(page: Page) {
  await page.locator('header button:not([aria-pressed])').click()
  await page.locator('[data-slot="dialog-content"]').waitFor()
}

/** Opens the account menu: the one button of the top bar that says it has something to expand. */
async function openAccountMenu(page: Page) {
  await page.locator('header button[aria-expanded]').click()
  await page.getByRole('dialog').waitFor()
}

/** Presses the last of the toggle buttons of the page's content: the tab "Failed" of the clips page. */
async function openLastTab(page: Page) {
  await page.locator('main button[aria-pressed]').last().click()
}

/** Opens the controls of the demo panel: the one button of the page's content that says it has something to expand. */
async function openDemoControls(page: Page) {
  // Not the whole page: the avatar of a signed-in visitor, in the top bar, says it as well.
  await page.locator('main button[aria-expanded="false"]').first().click()
}

/** {@link openDemoControls} on the match page itself; the scenario's other pages (the order dialog) are left as they are. */
async function openDemoControlsOnMatch(page: Page, shotPage: ShotPage) {
  if (shotPage.name === 'match') {
    await openDemoControls(page)
  }
}

/** Presses "Nuke" in the landing page's strip of maps and waits until the backdrop shows that map's scenery. */
async function pressOtherMap(page: Page) {
  await page.getByRole('button', { name: 'Nuke', exact: true }).click()
  // The backdrop's picture comes first in the page; the sample's frame draws the same file as well.
  await page.locator('main img[src*="scenes/de_nuke"]').first().waitFor({ state: 'attached' })
  await settle(page)
}

/** Scrolls the first scoreboard's box to its right end; a table that fits in its box does not move. */
async function scrollScoreboard(page: Page) {
  await page.locator('[data-slot="table-container"]').first().evaluate((box) => {
    box.scrollLeft = box.scrollWidth
  })
}

/** Puts a draft where the montage editor keeps it and opens the editor again, so that it starts from the draft. */
async function openWithDraft(page: Page, draft: object, fits = true) {
  const key = `csfaceit.montage.${WON_MATCH_ID}.${PLAYER_ID}`
  await page.evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(draft))})`)
  await page.reload()
  await settle(page)
  await page.getByRole(fits ? 'listbox' : 'status').first().waitFor()
}

/** A draft whose music the backend no longer offers: the editor opens empty and says why, once. */
async function openMontageStale(page: Page) {
  await openWithDraft(page, { ...MONTAGE_DRAFT, musicTrack: 'a-track-that-was-removed' }, false)
}

/**
 * The draft of four segments with its second one (the slow-motion triple kill) selected, and the playhead 10 s of the
 * video further on, past two of its kills, so that the monitor's kill feed has lines. A click in the top-left corner
 * then takes the focus off the ruler.
 */
async function openMontageEdit(page: Page) {
  await openWithDraft(page, MONTAGE_DRAFT)
  await page.getByRole('option').nth(1).click()
  const ruler = page.getByRole('slider')
  await ruler.press('Shift+ArrowRight')
  await ruler.press('Shift+ArrowRight')
  await page.mouse.click(1, 1)
}

/** The same draft vertical and with the intro: the playhead stays at the start, on the intro card. */
async function openMontageVertical(page: Page) {
  await openWithDraft(page, VERTICAL_DRAFT)
}

/** The draft's order: "Record the montage" (the header's on a desktop, the bottom bar's on a phone) opens the dialog. */
async function openMontageOrder(page: Page) {
  await openWithDraft(page, MONTAGE_DRAFT)
  await page.getByRole('button', { name: /Montajni yozish|Record the montage/ }).click()
  await page.locator('[data-slot="dialog-content"]').waitFor()
}

/** One test per scenario, page, width and language. */
function defineShots() {
  for (const scenario of SCENARIOS) {
    const backend: Backend = { ...DEFAULT_BACKEND, ...scenario.backend }
    const pages = PAGES.filter(
      (shotPage) =>
        (scenario.pages ? scenario.pages.includes(shotPage.name) : !('onRequest' in shotPage)) &&
        (!('signedIn' in shotPage) || backend.me !== null),
    )

    for (const language of scenario.languages ?? ['uz']) {
      test.describe(`${scenario.name} in ${language}`, () => {
        for (const viewport of scenario.viewports ?? DEFAULT_VIEWPORTS) {
          for (const shotPage of pages) {
            const name = `${scenario.name}-${shotPage.name}-${viewport.width}-${language}`

            test(name, async ({ page }) => {
              await page.setViewportSize(viewport)
              await page.emulateMedia({ reducedMotion: 'reduce' })
              await setLanguage(page, language)
              await mockApi(page, answersFor(backend))
              await page.goto(shotPage.path)
              await settle(page)
              if ('open' in shotPage) {
                await shotPage.open(page, backend)
                await settle(page)
              }
              await scenario.before?.(page, shotPage)
              await page.screenshot({ path: `shots/${name}.png`, fullPage: true, animations: 'disabled' })
            })
          }
        }
      })
    }
  }
}

if (process.env.SHOTS) {
  defineShots()
} else {
  // A normal `npm run e2e` shows this one line instead of one skipped test per picture.
  test.skip('screenshots: set SHOTS=1 to take them', () => {})
}
