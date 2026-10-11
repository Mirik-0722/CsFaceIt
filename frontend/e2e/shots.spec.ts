import { test, type Page } from '@playwright/test'
import type {
  MatchHistoryResponse,
  MatchResponse,
  MatchStatsResponse,
  PlayerResponse,
} from '../src/api/types.ts'
import {
  PLAYER_ID,
  WON_MATCH_ID,
  historyFixture,
  matchFixture,
  playerFixture,
  statsFixture,
} from './fixtures.ts'

/**
 * A screenshot tool, not a test: it opens the pages of the app in every scenario, at every width and language, and
 * writes a full-page PNG per combination to `shots/<scenario>-<page>-<width>-<language>.png`, to be compared with
 * the design spec by eye. Nothing is asserted. It is skipped unless SHOTS is set:
 *
 *   SHOTS=1 npx playwright test e2e/shots.spec.ts
 *
 * The API is mocked as in search-flow.spec.ts. To photograph more, add a row to PAGES or to SCENARIOS: the loop at
 * the bottom turns the two tables into tests.
 */

type Language = 'uz' | 'en'

/** What the mocked backend serves; a scenario replaces the parts it needs to. */
interface Backend {
  /** The nickname typed into the search form; the search request is answered only for this one. */
  nickname: string
  player: PlayerResponse
  history: MatchHistoryResponse
  match: MatchResponse
  /** `null`: FACEIT has no stats for the match yet (the backend answers 404 MATCH_NOT_FOUND). */
  stats: MatchStatsResponse | null
}

interface ShotPage {
  name: string
  /** Where the page starts. */
  path: string
  /** Takes the page from `path` to the state that is photographed, when opening the URL is not enough. */
  open?: (page: Page, backend: Backend) => Promise<void>
}

interface Scenario {
  name: string
  /** Replaces parts of the default backend. */
  backend?: Partial<Backend>
  /** The pages it photographs: all of them when left out. */
  pages?: PageName[]
  /** The languages it photographs in: Uzbek only when left out. */
  languages?: Language[]
  /** The last thing done to the page before the picture. */
  before?: (page: Page) => Promise<void>
}

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]

// The `localStorage` key of the language choice: LOCALE_STORAGE_KEY of src/i18n, repeated here because that module
// needs a DOM to load and this file runs in Node.
const LANGUAGE_KEY = 'csfaceit.lang'

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'result', path: '/', open: searchFor },
  { name: 'player', path: `/players/${PLAYER_ID}` },
  { name: 'match', path: `/matches/${WON_MATCH_ID}` },
  { name: 'notfound', path: '/there-is-no-such-page' },
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
}

const SCENARIOS: Scenario[] = [
  { name: 'default', languages: ['uz', 'en'] },
  {
    // A 32-character nickname and team names longer than 32 characters (one with spaces, one without).
    name: 'long',
    pages: ['result', 'player', 'match'],
    backend: {
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
    },
  },
  {
    // A player without CS2 data and without a single match.
    name: 'empty',
    pages: ['result', 'player'],
    backend: {
      player: { ...playerFixture, avatar: null, country: null, elo: null, level: null },
      history: { items: [], offset: 0, limit: 20 },
    },
  },
  {
    // A match that is still being played: FACEIT has published neither the map nor the times nor a winner, no stats.
    name: 'live',
    pages: ['match'],
    backend: {
      match: { ...matchFixture, mapName: null, startedAt: null, finishedAt: null, winner: null, status: 'ONGOING' },
      stats: null,
    },
  },
  // Where the focus ring is after three presses of Tab, from the top of each page.
  { name: 'focus', before: tabThreeTimes },
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
  return new Map<string, Reply>([
    [`GET /api/v1/players?nickname=${backend.nickname}`, { body: backend.player }],
    [`GET /api/v1/players/${PLAYER_ID}`, { body: backend.player }],
    [`GET /api/v1/players/${PLAYER_ID}/history?offset=0&limit=20`, { body: backend.history }],
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

async function tabThreeTimes(page: Page) {
  // A click in the top-left corner (nothing to click there) makes Tab start from the top of the page, whatever the
  // page did before: the search leaves the focus in its form.
  await page.mouse.click(1, 1)
  for (let press = 0; press < 3; press++) {
    await page.keyboard.press('Tab')
  }
}

/** One test per scenario, page, width and language. */
function defineShots() {
  for (const scenario of SCENARIOS) {
    const backend: Backend = { ...DEFAULT_BACKEND, ...scenario.backend }
    const pages = PAGES.filter(({ name }) => !scenario.pages || scenario.pages.includes(name))

    for (const language of scenario.languages ?? ['uz']) {
      test.describe(`${scenario.name} in ${language}`, () => {
        test.use({ storageState: languageState(language) })

        for (const viewport of VIEWPORTS) {
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
              await scenario.before?.(page)
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
