import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MatchHistoryResponse, MatchSummary, PlayerResponse } from '@/api/types'
import { deferred, mockFetchRoutes, renderWithProviders, type MockReply } from '@/test/utils'
import PlayerPage from './PlayerPage'

const PAGE_SIZE = 20

const s1mple: PlayerResponse = {
  playerId: 'p1',
  nickname: 's1mple',
  elo: 3500,
  level: 10,
  avatar: null,
  country: 'UA',
}

const PLAYER_URL = '/api/v1/players/p1'
const FIRST_PAGE_URL = '/api/v1/players/p1/history?offset=0&limit=20'
const SECOND_PAGE_URL = '/api/v1/players/p1/history?offset=20&limit=20'

/**
 * `count` matches named `m{first}`, `m{first + 1}`, ... whose score is `13 : {id}`, so each row is distinguishable.
 * The list shows the player's own rounds first, so the 13 is the player's: a win up to 13 : 13, a loss above it.
 */
function matches(first: number, count: number): MatchSummary[] {
  return Array.from({ length: count }, (_, i) => ({
    matchId: `m${first + i}`,
    startedAt: '2026-10-01T10:00:00Z',
    finishedAt: '2026-10-01T10:45:00Z',
    result: first + i > 13 ? 'LOSS' : 'WIN',
    score: { faction1: 13, faction2: first + i },
  }))
}

function page(items: MatchSummary[], offset: number): { body: MatchHistoryResponse } {
  return { body: { items, offset, limit: PAGE_SIZE } }
}

function renderPlayerPage(route = '/players/p1') {
  return renderWithProviders(<PlayerPage />, { route, path: '/players/:playerId' })
}

describe('PlayerPage', () => {
  it('shows the player header and the first page of matches', async () => {
    mockFetchRoutes({ [PLAYER_URL]: { body: s1mple }, [FIRST_PAGE_URL]: page(matches(1, 3), 0) })
    renderPlayerPage()

    expect(await screen.findByText('s1mple')).toBeInTheDocument()
    expect(screen.getByText('ELO 3500')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /13 : 2$/ })).toHaveAttribute('href', '/matches/m2')
    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 1, name: 'Player profile' })).toBeInTheDocument()
  })

  it('shows skeleton placeholders announced as loading until the data arrives', async () => {
    const playerAnswer = deferred<MockReply>()
    const historyAnswer = deferred<MockReply>()
    mockFetchRoutes({ [PLAYER_URL]: () => playerAnswer.promise, [FIRST_PAGE_URL]: () => historyAnswer.promise })
    const { container } = renderPlayerPage()

    const loadingPlayer = screen.getByText('Loading player…')
    const loadingMatches = screen.getByText('Loading matches…')
    expect(loadingPlayer.closest('[aria-live="polite"]')).not.toBeNull()
    expect(loadingMatches.closest('[aria-live="polite"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)

    playerAnswer.resolve({ body: s1mple })
    historyAnswer.resolve(page(matches(1, 1), 0))
    expect(await screen.findByText('s1mple')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /13 : 1$/ })).toBeInTheDocument()
    expect(screen.queryByText('Loading player…')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading matches…')).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
  })

  it('shows a player without CS2 data', async () => {
    mockFetchRoutes({
      [PLAYER_URL]: { body: { ...s1mple, elo: null, level: null, avatar: null, country: null } },
      [FIRST_PAGE_URL]: page([], 0),
    })
    renderPlayerPage()
    expect(await screen.findByText('No CS2 data')).toBeInTheDocument()
    expect(screen.queryByText(/ELO/)).not.toBeInTheDocument()
  })

  describe('load more', () => {
    it('appends the next page and hides the button once a page is short', async () => {
      const fetchMock = mockFetchRoutes({
        [PLAYER_URL]: { body: s1mple },
        [FIRST_PAGE_URL]: page(matches(1, PAGE_SIZE), 0),
        [SECOND_PAGE_URL]: page(matches(21, 3), 20),
      })
      renderPlayerPage()

      expect(await screen.findByRole('link', { name: /13 : 20$/ })).toBeInTheDocument()
      expect(screen.getAllByRole('link')).toHaveLength(20)

      await userEvent.click(screen.getByRole('button', { name: 'Load more' }))

      expect(await screen.findByRole('link', { name: /13 : 23$/ })).toBeInTheDocument()
      const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
      expect(hrefs).toHaveLength(23)
      expect(hrefs[0]).toBe('/matches/m1')
      expect(hrefs[19]).toBe('/matches/m20')
      expect(hrefs[22]).toBe('/matches/m23')
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith(SECOND_PAGE_URL, expect.anything())
    })

    it('offers another page after a full second page', async () => {
      mockFetchRoutes({
        [PLAYER_URL]: { body: s1mple },
        [FIRST_PAGE_URL]: page(matches(1, PAGE_SIZE), 0),
        [SECOND_PAGE_URL]: page(matches(21, PAGE_SIZE), 20),
        '/api/v1/players/p1/history?offset=40&limit=20': page(matches(41, 1), 40),
      })
      renderPlayerPage()

      await userEvent.click(await screen.findByRole('button', { name: 'Load more' }))
      expect(await screen.findByRole('link', { name: /13 : 40$/ })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Load more' }))

      expect(await screen.findByRole('link', { name: /13 : 41$/ })).toBeInTheDocument()
      expect(screen.getAllByRole('link')).toHaveLength(41)
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    })

    it('disables the button while a page is loading', async () => {
      const secondPage = deferred<MockReply>()
      mockFetchRoutes({
        [PLAYER_URL]: { body: s1mple },
        [FIRST_PAGE_URL]: page(matches(1, PAGE_SIZE), 0),
        [SECOND_PAGE_URL]: () => secondPage.promise,
      })
      renderPlayerPage()

      await userEvent.click(await screen.findByRole('button', { name: 'Load more' }))
      expect(screen.getByRole('button', { name: 'Load more' })).toBeDisabled()
      expect(screen.getAllByRole('link')).toHaveLength(20)

      secondPage.resolve(page(matches(21, 2), 20))
      expect(await screen.findByRole('link', { name: /13 : 22$/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    })

    it('keeps the loaded matches and the button when the next page fails', async () => {
      mockFetchRoutes({
        [PLAYER_URL]: { body: s1mple },
        [FIRST_PAGE_URL]: page(matches(1, PAGE_SIZE), 0),
        [SECOND_PAGE_URL]: { body: { code: 'FACEIT_UNAVAILABLE', message: 'x' }, status: 502 },
      })
      renderPlayerPage()

      await userEvent.click(await screen.findByRole('button', { name: 'Load more' }))

      expect(await screen.findByText('FACEIT is temporarily unavailable. Try again later.')).toBeInTheDocument()
      expect(screen.getAllByRole('link')).toHaveLength(20)
      expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled()
    })

    it('has no button when the first page is short', async () => {
      mockFetchRoutes({ [PLAYER_URL]: { body: s1mple }, [FIRST_PAGE_URL]: page(matches(1, PAGE_SIZE - 1), 0) })
      renderPlayerPage()
      expect(await screen.findByRole('link', { name: /13 : 19$/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    })
  })

  it('says there are no matches yet for an empty history', async () => {
    mockFetchRoutes({ [PLAYER_URL]: { body: s1mple }, [FIRST_PAGE_URL]: page([], 0) })
    renderPlayerPage()
    expect(await screen.findByText('No matches yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  describe('errors', () => {
    it('shows not-found and no history for an unknown player', async () => {
      const notFound = { body: { code: 'PLAYER_NOT_FOUND', message: 'x' }, status: 404 }
      mockFetchRoutes({
        '/api/v1/players/ghost': notFound,
        '/api/v1/players/ghost/history?offset=0&limit=20': notFound,
      })
      renderPlayerPage('/players/ghost')

      const message = await screen.findByText('Player not found')
      expect(message.closest('[aria-live="polite"]')).not.toBeNull()
      expect(screen.queryByText('No matches yet')).not.toBeInTheDocument()
      expect(screen.queryByText('Loading matches…')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
      expect(screen.getAllByText('Player not found')).toHaveLength(1)
    })

    it('says FACEIT is unavailable on 502', async () => {
      const unavailable = { body: { code: 'FACEIT_UNAVAILABLE', message: 'x' }, status: 502 }
      mockFetchRoutes({ [PLAYER_URL]: unavailable, [FIRST_PAGE_URL]: unavailable })
      renderPlayerPage()
      expect(await screen.findByText('FACEIT is temporarily unavailable. Try again later.')).toBeInTheDocument()
    })

    it('shows a generic message for any other error', async () => {
      const broken = { body: { code: 'INTERNAL_ERROR', message: 'x' }, status: 500 }
      mockFetchRoutes({ [PLAYER_URL]: broken, [FIRST_PAGE_URL]: broken })
      renderPlayerPage()
      expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument()
    })

    it('shows the profile and the history error when only the history fails', async () => {
      mockFetchRoutes({
        [PLAYER_URL]: { body: s1mple },
        [FIRST_PAGE_URL]: { body: { code: 'FACEIT_UNAVAILABLE', message: 'x' }, status: 502 },
      })
      renderPlayerPage()
      expect(await screen.findByText('s1mple')).toBeInTheDocument()
      expect(await screen.findByText('FACEIT is temporarily unavailable. Try again later.')).toBeInTheDocument()
      expect(screen.queryByText('No matches yet')).not.toBeInTheDocument()
    })

    it('shows not-found without a request when the route has no player id', () => {
      const fetchMock = mockFetchRoutes({})
      renderWithProviders(<PlayerPage />, { route: '/players' })
      expect(screen.getByText('Player not found')).toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it('encodes the id from the URL when it asks for the player', async () => {
    const fetchMock = mockFetchRoutes({
      '/api/v1/players/a%20b': { body: { ...s1mple, playerId: 'a b' } },
      '/api/v1/players/a%20b/history?offset=0&limit=20': page([], 0),
    })
    renderPlayerPage('/players/a%20b')
    const region = (await screen.findByText('s1mple')).closest('[aria-live="polite"]')
    expect(region).not.toBeNull()
    expect(within(region as HTMLElement).getByText('ELO 3500')).toBeInTheDocument()
    await screen.findByText('No matches yet')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/players/a%20b', expect.anything())
  })
})
