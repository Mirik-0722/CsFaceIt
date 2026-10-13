import { expect, test as base, type Locator } from '@playwright/test'
import {
  PLAYER_ID,
  WON_MATCH_ID,
  breakdownFixture,
  demoFixture,
  historyFixture,
  matchFixture,
  matchHighlightsFixture,
  playerFixture,
  playerHighlightsFixture,
  playerOverviewFixture,
  playerStatsFixture,
  recorderStatusFixture,
  statsFixture,
} from './fixtures.ts'

/**
 * Every API call the flow makes, keyed by method, path and query string exactly as the app sends them, with the
 * response the mocked backend gives. Any other `/api/` request is a failure (see the `api` fixture).
 */
const API_RESPONSES = new Map<string, unknown>([
  ['GET /api/v1/players?nickname=s1mple', playerFixture],
  [`GET /api/v1/players/${PLAYER_ID}`, playerFixture],
  [`GET /api/v1/players/${PLAYER_ID}/history?offset=0&limit=20`, historyFixture],
  [`GET /api/v1/players/${PLAYER_ID}/stats`, playerStatsFixture],
  [`GET /api/v1/players/${PLAYER_ID}/overview`, playerOverviewFixture],
  [`GET /api/v1/players/${PLAYER_ID}/highlights?offset=0&limit=6`, playerHighlightsFixture],
  // No clip has been recorded in this flow: both lists are empty, and the recorder is asked about on the match page.
  [`GET /api/v1/players/${PLAYER_ID}/clips?offset=0&limit=12`, { items: [], offset: 0, limit: 12 }],
  [`GET /api/v1/matches/${WON_MATCH_ID}`, matchFixture],
  [`GET /api/v1/matches/${WON_MATCH_ID}/stats`, statsFixture],
  [`GET /api/v1/matches/${WON_MATCH_ID}/breakdown`, breakdownFixture],
  [`GET /api/v1/matches/${WON_MATCH_ID}/demo`, demoFixture],
  [`GET /api/v1/matches/${WON_MATCH_ID}/highlights`, matchHighlightsFixture],
  [`GET /api/v1/matches/${WON_MATCH_ID}/clips`, []],
  ['GET /api/v1/recorder/status', recorderStatusFixture],
  // The top bar asks who is signed in (nobody: see API_STATUS), the hero which ways of signing in there are.
  ['GET /api/v1/auth/me', null],
  ['GET /api/v1/auth/providers', { steam: true, faceit: false }],
])

/** The status of an answer when it is not 200. */
const API_STATUS = new Map<string, number>([['GET /api/v1/auth/me', 204]])

const test = base.extend<{ api: { served: Set<string> } }>({
  // Answers the API from fixtures. A request without a fixture is aborted and fails the test once it has finished, so
  // it can never reach the Vite proxy (and a backend that is not running). The predicate matches the path prefix only:
  // a glob like `**/api/**` would also catch the dev server's own `/src/api/*.ts` modules.
  api: async ({ page }, use) => {
    const served = new Set<string>()
    const unmocked: string[] = []
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      async (route) => {
        const url = new URL(route.request().url())
        const key = `${route.request().method()} ${url.pathname}${url.search}`
        if (API_RESPONSES.has(key)) {
          served.add(key)
          const status = API_STATUS.get(key) ?? 200
          // A 204 has no body, so there is no JSON to send with it.
          await route.fulfill(status === 204 ? { status } : { status, json: API_RESPONSES.get(key) })
        } else {
          unmocked.push(key)
          await route.abort()
        }
      },
    )
    await use({ served })
    expect(unmocked, 'API requests that have no fixture').toEqual([])
  },
})

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error(`${locator} has no bounding box: it is not rendered`)
  }
  return box
}

/** The team header (the table caption) has to sit above the column headers and the first player row. */
async function expectCaptionOnTop(table: Locator) {
  const caption = await boxOf(table.locator('caption'))
  const columnHeaders = await boxOf(table.locator('thead'))
  const firstRow = await boxOf(table.locator('tbody tr').first())
  expect(caption.y + caption.height).toBeLessThanOrEqual(columnHeaders.y)
  expect(caption.y + caption.height).toBeLessThanOrEqual(firstRow.y)
}

test('search -> profile -> match stats', async ({ page, api }) => {
  await test.step('search for a player', async () => {
    await page.goto('/')
    await page.getByLabel('nickname').fill('s1mple')
    await page.getByRole('button', { name: /search/i }).click()
    await page.getByRole('link', { name: /s1mple/ }).click()
  })

  await test.step('open the profile and see the match history', async () => {
    await expect(page).toHaveURL(`/players/${PLAYER_ID}`)
    await expect(page.getByText('ELO 3,500')).toBeVisible()
    await expect(page.getByText('Level 10')).toBeVisible()

    const matches = page.getByRole('link', { name: /\d+ : \d+/ })
    await expect(matches).toHaveCount(historyFixture.items.length)
    await expect(page.getByRole('link', { name: /13 : 9/ })).toContainText('WIN')
    await expect(page.getByRole('link', { name: /14 : 16/ })).toContainText('LOSS')
  })

  await test.step('open the match and read both scoreboards', async () => {
    await page.getByRole('link', { name: /13 : 9/ }).click()
    await expect(page).toHaveURL(`/matches/${WON_MATCH_ID}`)
    // The map is the title of the match's panel. The profile, which stays on screen for a moment after the address has
    // changed, names the same map in its own lists, so the title is asked for by where it stands.
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: /^Mirage$/ })).toBeVisible()
    await expect(page.getByRole('cell', { name: '25', exact: true })).toBeVisible()

    const teamA = page.getByRole('table').filter({ has: page.getByRole('heading', { name: 'team_A' }) })
    const teamB = page.getByRole('table').filter({ has: page.getByRole('heading', { name: 'team_B' }) })
    await expect(page.getByRole('table')).toHaveCount(2)

    const s1mple = teamA.getByRole('row').filter({ has: page.getByRole('link', { name: 's1mple' }) })
    await expect(s1mple.getByRole('cell')).toHaveText([
      's1mple',
      '25',
      '14',
      '3',
      '1.79',
      '95.4',
      '48%',
      '77%',
      '5',
      '3',
      '1/2',
    ])

    // Only the winning team is marked, and each team's header is rendered above its own rows.
    await expect(page.getByText('Winner')).toHaveCount(1)
    await expect(teamA.getByText('Winner')).toBeVisible()
    await expect(teamB.getByText('Winner')).toHaveCount(0)
    await expect(teamA.locator('caption')).toContainText('Score: 13')
    await expect(teamB.locator('caption')).toContainText('Score: 9')
    await expectCaptionOnTop(teamA)
    await expectCaptionOnTop(teamB)
  })

  await test.step('go back to the profile', async () => {
    await page.goBack()
    await expect(page).toHaveURL(`/players/${PLAYER_ID}`)
    await expect(page.getByText('ELO 3,500')).toBeVisible()
    await expect(page.getByRole('link', { name: /13 : 9/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /14 : 16/ })).toBeVisible()
  })

  // Every fixture was used, so none of them is dead weight that would hide a missing request.
  expect([...api.served].sort()).toEqual([...API_RESPONSES.keys()].sort())
})
