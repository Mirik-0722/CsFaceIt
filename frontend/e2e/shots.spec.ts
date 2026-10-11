import { test, type Page } from '@playwright/test'
import type {
  DemoResponse,
  HighlightResponse,
  MatchHistoryResponse,
  MatchResponse,
  MatchStatsResponse,
  MatchSummary,
  PlayerAggregateStatsResponse,
  PlayerResponse,
} from '../src/api/types.ts'
import {
  PLAYER_ID,
  WON_MATCH_ID,
  demoFixture,
  highlightFixture,
  historyFixture,
  matchFixture,
  matchHighlightsFixture,
  playerFixture,
  playerStatsFixture,
  statsFixture,
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
  /** The player's figures over the stored matches. */
  playerStats: PlayerAggregateStatsResponse
  /** The highlights of the match. The player's own are also the profile's newest six and the highlights page. */
  highlights: HighlightResponse[]
  /** `null`: the match has no demo (the backend answers 404 DEMO_NOT_FOUND). */
  demo: DemoResponse | null
}

interface ShotPage {
  name: string
  /** Where the page starts. */
  path: string
  /**
   * Presses of Tab, from the top of the page, that put the focus on an element of the page's own content (the `focus`
   * scenario photographs it). The top bar takes the first three stops (the logo, UZ and EN), so the content starts
   * at the fourth: count again when a page gains or loses a focusable element before the one that is photographed.
   */
  tabs: number
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

// `tabs` is explained on ShotPage; the comment on each row names the element the `focus` scenario lands on.
const PAGES = [
  { name: 'home', path: '/', tabs: 4 }, // the nickname field
  { name: 'result', path: '/', open: searchFor, tabs: 6 }, // the link around the player card (after field and button)
  { name: 'player', path: `/players/${PLAYER_ID}`, tabs: 4 }, // the player of the first highlight card
  { name: 'highlights', path: `/players/${PLAYER_ID}/highlights`, tabs: 5 }, // the type filter (after the player card)
  { name: 'match', path: `/matches/${WON_MATCH_ID}`, tabs: 5 }, // the first filter button (after "Manage")
  { name: 'notfound', path: '/there-is-no-such-page', tabs: 4 }, // the link back to the search
] as const satisfies readonly ShotPage[]

type PageName = (typeof PAGES)[number]['name']

const LONG_NICKNAME = 'ThirtyTwo_Characters_Nickname_01'
const LONG_TEAM_NAMES = [
  'Natus Vincere Academy Under-Twenty Regional Roster',
  'Team_With_An_Unbreakable_Very_Long_Name_2026',
]

const DEFAULT_BACKEND: Backend = {
  nickname: 's1mple',
  player: playerFixture,
  history: historyFixture,
  match: matchFixture,
  stats: statsFixture,
  playerStats: playerStatsFixture,
  highlights: matchHighlightsFixture,
  demo: demoFixture,
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

const SCENARIOS: Scenario[] = [
  { name: 'default', languages: ['uz', 'en'] },
  // The same pages once more, in Uzbek, on the narrowest phone.
  { name: 'default', viewports: [SMALL_PHONE] },
  {
    name: 'long',
    pages: ['result', 'player', 'highlights', 'match'],
    backend: LONG_BACKEND,
  },
  {
    // A player without CS2 data, without a single match, a stored figure or a highlight.
    name: 'empty',
    pages: ['result', 'player', 'highlights'],
    backend: {
      player: { ...playerFixture, avatar: null, country: null, elo: null, level: null },
      history: { items: [], offset: 0, limit: 20 },
      playerStats: NO_PLAYER_STATS,
      highlights: [],
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
      demo: null,
      highlights: [],
    },
  },
  {
    // What real data holds that the default does not: a history of 20 rows (with "Load more", an UNKNOWN result and a
    // row without a score), a match whose second team has an empty roster, stored matches without an analyzed demo,
    // a demo whose analysis failed, and the highlights of EDGE_HIGHLIGHTS.
    name: 'edge',
    pages: ['player', 'highlights', 'match'],
    backend: {
      history: edgeHistory(),
      match: { ...matchFixture, teams: [matchFixture.teams[0], { ...matchFixture.teams[1], players: [] }] },
      stats: { ...statsFixture, teams: [statsFixture.teams[0], { ...statsFixture.teams[1], players: [] }] },
      playerStats: { ...NO_PLAYER_STATS, matches: 7, winRate: 42.9, kd: 0.94, hsPercent: 38.5, adr: 71.3 },
      highlights: EDGE_HIGHLIGHTS,
      demo: { ...demoFixture, status: 'PARSED', error: 'Analysis failed: round 7 has no kill rows to order (IllegalStateException)' },
    },
  },
  // The demo panel opened: the admin key field and the three requests it guards.
  { name: 'manage', pages: ['match'], before: openDemoControls },
  // The first scoreboard scrolled to its right end, on a phone: the player column and the team header stay in place.
  // The default scoreboard fits in 390px and has nothing to scroll; the one with the 32-character nickname overflows.
  { name: 'scrolled-long', pages: ['match'], viewports: [PHONE], backend: LONG_BACKEND, before: scrollScoreboard },
  // Where the focus ring is on each page's content: the element that the page's `tabs` presses of Tab reach.
  { name: 'focus', before: pressTab },
]

/** The `uz`/`en` choice as the app reads it: a context that starts with the key set in `localStorage`. */
function languageState(language: Language) {
  return {
    cookies: [],
    origins: [{ origin: 'http://localhost:5173', localStorage: [{ name: LANGUAGE_KEY, value: language }] }],
  }
}

interface Reply {
  status?: number
  body: unknown
}

/** Every API call the pages make, keyed by method, path and query as the app sends them. */
function answersFor(backend: Backend): Map<string, Reply> {
  const own = backend.highlights.filter((highlight) => highlight.playerId === PLAYER_ID)
  return new Map<string, Reply>([
    [`GET /api/v1/players?nickname=${backend.nickname}`, { body: backend.player }],
    [`GET /api/v1/players/${PLAYER_ID}`, { body: backend.player }],
    [`GET /api/v1/players/${PLAYER_ID}/history?offset=0&limit=20`, { body: backend.history }],
    [`GET /api/v1/players/${PLAYER_ID}/stats`, { body: backend.playerStats }],
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
  ])
}

async function mockApi(page: Page, answers: Map<string, Reply>) {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const url = new URL(route.request().url())
      const key = `${route.request().method()} ${url.pathname}${url.search}`
      const reply = answers.get(key)
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

/** Presses Tab as often as the page's `tabs` say, from the top of the page. */
async function pressTab(page: Page, { tabs }: ShotPage) {
  // A click in the top-left corner (nothing to click there) makes Tab start from the top of the page, whatever the
  // page did before: the search leaves the focus in its form.
  await page.mouse.click(1, 1)
  for (let press = 0; press < tabs; press++) {
    await page.keyboard.press('Tab')
  }
}

/** Opens the controls of the demo panel: the one button on the page that says it has something to expand. */
async function openDemoControls(page: Page) {
  await page.locator('button[aria-expanded="false"]').first().click()
}

/** Scrolls the first scoreboard's box to its right end; a table that fits in its box does not move. */
async function scrollScoreboard(page: Page) {
  await page.locator('[data-slot="table-container"]').first().evaluate((box) => {
    box.scrollLeft = box.scrollWidth
  })
}

/** One test per scenario, page, width and language. */
function defineShots() {
  for (const scenario of SCENARIOS) {
    const backend: Backend = { ...DEFAULT_BACKEND, ...scenario.backend }
    const pages = PAGES.filter(({ name }) => !scenario.pages || scenario.pages.includes(name))

    for (const language of scenario.languages ?? ['uz']) {
      test.describe(`${scenario.name} in ${language}`, () => {
        test.use({ storageState: languageState(language) })

        for (const viewport of scenario.viewports ?? DEFAULT_VIEWPORTS) {
          for (const shotPage of pages) {
            const name = `${scenario.name}-${shotPage.name}-${viewport.width}-${language}`

            test(name, async ({ page }) => {
              await page.setViewportSize(viewport)
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
