import { act, screen, waitFor, within } from '@testing-library/react'
import type { MatchResponse, MatchStatsResponse, PlayerStatsResponse, TeamStatsResponse } from '@/api/types'
import { deferred, mockFetchRoutes as mockRoutes, renderWithProviders, type MockReply } from '@/test/utils'
import MatchPage from './MatchPage'

// The page also asks for the match's demo, highlights, clips and breakdown. Every test gets the answers of a match
// without a demo, for each id a test uses, next to the routes it sets up itself.
function mockFetchRoutes(routes: Parameters<typeof mockRoutes>[0]) {
  const extra: Parameters<typeof mockRoutes>[0] = {}
  for (const id of ['m1', 'a%20b']) {
    extra[`/api/v1/matches/${id}/demo`] = { body: { code: 'DEMO_NOT_FOUND', message: 'x' }, status: 404 }
    extra[`/api/v1/matches/${id}/highlights`] = { body: [] }
    extra[`/api/v1/matches/${id}/clips`] = { body: [] }
    extra[`/api/v1/matches/${id}/breakdown`] = { body: { matchId: id, rounds: [], players: [] } }
  }
  return mockRoutes({ ...extra, ...routes })
}

const MATCH_URL = '/api/v1/matches/m1'
const STATS_URL = '/api/v1/matches/m1/stats'

const match: MatchResponse = {
  matchId: 'm1',
  mapName: 'de_mirage',
  status: 'FINISHED',
  startedAt: '2026-10-01T10:00:00Z',
  finishedAt: '2026-10-01T10:45:00Z',
  demoUrl: null,
  teams: [
    { factionId: 'faction1', name: 'Natus Vincere', players: [{ playerId: 'p1', nickname: 's1mple' }] },
    { factionId: 'faction2', name: 'Vitality', players: [{ playerId: 'p2', nickname: 'ZywOo' }] },
  ],
  winner: 'faction1',
}

function player(overrides: Partial<PlayerStatsResponse>): PlayerStatsResponse {
  return {
    playerId: 'p1',
    nickname: 's1mple',
    kills: 25,
    deaths: 14,
    assists: 5,
    headshots: 12,
    kdRatio: 1.79,
    krRatio: 0.9,
    adr: 95.4,
    ...overrides,
  }
}

function team(overrides: Partial<TeamStatsResponse>): TeamStatsResponse {
  return { teamId: 't1', name: 'Natus Vincere', score: 13, win: true, players: [player({})], ...overrides }
}

const stats: MatchStatsResponse = {
  matchId: 'm1',
  mapName: 'de_mirage',
  rounds: 22,
  teams: [
    team({}),
    team({
      teamId: 't2',
      name: 'Vitality',
      score: 9,
      win: false,
      players: [player({ playerId: 'p2', nickname: 'ZywOo', kills: 20, deaths: 17 })],
    }),
  ],
}

const NOT_FOUND = { body: { code: 'MATCH_NOT_FOUND', message: 'x' }, status: 404 }
const UNAVAILABLE = { body: { code: 'FACEIT_UNAVAILABLE', message: 'x' }, status: 502 }
const BROKEN = { body: { code: 'INTERNAL_ERROR', message: 'x' }, status: 500 }

function renderMatchPage(route = '/matches/m1') {
  return renderWithProviders(<MatchPage />, { route, path: '/matches/:matchId' })
}

describe('MatchPage', () => {
  it('shows the match header and one stats table per team', async () => {
    mockFetchRoutes({ [MATCH_URL]: { body: match }, [STATS_URL]: { body: stats } })
    renderMatchPage()

    expect(await screen.findByRole('table', { name: /Natus Vincere/ })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /Vitality/ })).toBeInTheDocument()
    expect(screen.getAllByRole('table')).toHaveLength(2)
    expect(screen.getByRole('heading', { level: 1, name: 'Match' })).toBeInTheDocument()
    expect(screen.getByText('Mirage')).toBeInTheDocument()
    expect(screen.getByText('01 Oct 2026')).toHaveAttribute('datetime', '2026-10-01T10:00:00Z')
    // A match that is over has no word for it in the header; any other state is said (see the ONGOING match below).
    expect(screen.queryByText('FINISHED')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 's1mple' })).toHaveAttribute('href', '/players/p1')
    expect(screen.getByRole('link', { name: 'ZywOo' })).toHaveAttribute('href', '/players/p2')
  })

  it('shows the map name exactly once, in the page header and not in each table', async () => {
    mockFetchRoutes({ [MATCH_URL]: { body: match }, [STATS_URL]: { body: stats } })
    renderMatchPage()
    await screen.findAllByRole('table')
    expect(screen.getAllByText('Mirage')).toHaveLength(1)
    expect(screen.getAllByText(/mirage/i)).toHaveLength(1)
  })

  it('marks the winning team only', async () => {
    mockFetchRoutes({ [MATCH_URL]: { body: match }, [STATS_URL]: { body: stats } })
    renderMatchPage()
    const winner = await screen.findByRole('table', { name: /Natus Vincere/ })
    expect(within(winner).getByText('Winner')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: /Vitality/ })).queryByText('Winner')).not.toBeInTheDocument()
    expect(screen.getAllByText('Winner')).toHaveLength(1)
  })

  it('requests the match and its stats by the id from the URL', async () => {
    const fetchMock = mockFetchRoutes({
      '/api/v1/matches/a%20b': { body: { ...match, matchId: 'a b' } },
      '/api/v1/matches/a%20b/stats': { body: stats },
    })
    renderMatchPage('/matches/a%20b')
    await screen.findAllByRole('table')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/matches/a%20b', expect.anything())
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/matches/a%20b/stats', expect.anything())
  })

  it('shows skeleton placeholders announced as loading until the data arrives', async () => {
    const matchAnswer = deferred<MockReply>()
    const statsAnswer = deferred<MockReply>()
    mockFetchRoutes({ [MATCH_URL]: () => matchAnswer.promise, [STATS_URL]: () => statsAnswer.promise })
    const { container } = renderMatchPage()

    const loadingMatch = screen.getByText('Loading match…')
    const loadingStats = screen.getByText('Loading stats…')
    expect(loadingMatch.closest('[aria-live="polite"]')).not.toBeNull()
    expect(loadingStats.closest('[aria-live="polite"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    matchAnswer.resolve({ body: match })
    expect(await screen.findByText('Mirage')).toBeInTheDocument()
    expect(screen.getByText('Loading stats…')).toBeInTheDocument()
    expect(screen.queryByText('Loading match…')).not.toBeInTheDocument()

    statsAnswer.resolve({ body: stats })
    expect(await screen.findAllByRole('table')).toHaveLength(2)
    expect(screen.queryByText('Loading stats…')).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
  })

  it('keeps the loaded tables when a later refetch of the stats fails', async () => {
    let statsRequests = 0
    mockFetchRoutes({
      [MATCH_URL]: { body: match },
      [STATS_URL]: async () => (++statsRequests === 1 ? { body: stats } : UNAVAILABLE),
    })
    renderMatchPage()
    await screen.findAllByRole('table')

    // Coming back to the tab refetches the stale stats; the failed refetch (and its one retry) must not blank them.
    await act(async () => {
      window.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(statsRequests).toBe(3))
    await act(async () => {})

    expect(screen.getAllByRole('table')).toHaveLength(2)
    expect(screen.queryByText('FACEIT is temporarily unavailable. Try again later.')).not.toBeInTheDocument()
  })

  describe('a match whose stats are not available', () => {
    it('shows the header and a notice instead of an error when the stats answer 404 MATCH_NOT_FOUND', async () => {
      mockFetchRoutes({ [MATCH_URL]: { body: { ...match, status: 'ONGOING' } }, [STATS_URL]: NOT_FOUND })
      renderMatchPage()

      const notice = await screen.findByText('Stats are not available for this match yet.')
      expect(notice.closest('[aria-live="polite"]')).not.toBeNull()
      expect(screen.getByText('Mirage')).toBeInTheDocument()
      expect(screen.getByText('ONGOING')).toBeInTheDocument()
      expect(screen.queryByText('Match not found')).not.toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('shows the same notice when FACEIT reports no teams', async () => {
      mockFetchRoutes({ [MATCH_URL]: { body: match }, [STATS_URL]: { body: { ...stats, mapName: null, rounds: 0, teams: [] } } })
      renderMatchPage()
      expect(await screen.findByText('Stats are not available for this match yet.')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('shows the stats error and keeps the header when the stats fail for another reason', async () => {
      mockFetchRoutes({ [MATCH_URL]: { body: match }, [STATS_URL]: UNAVAILABLE })
      renderMatchPage()
      expect(await screen.findByText('FACEIT is temporarily unavailable. Try again later.')).toBeInTheDocument()
      expect(screen.getByText('Mirage')).toBeInTheDocument()
      expect(screen.queryByText('Stats are not available for this match yet.')).not.toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })
  })

  describe('when the match request fails', () => {
    it('says the match was not found, and shows no tables even though the stats loaded', async () => {
      mockFetchRoutes({ [MATCH_URL]: NOT_FOUND, [STATS_URL]: { body: stats } })
      renderMatchPage()

      const message = await screen.findByText('Match not found')
      expect(message.closest('[aria-live="polite"]')).not.toBeNull()
      expect(screen.getAllByText('Match not found')).toHaveLength(1)
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(screen.queryByText('Loading stats…')).not.toBeInTheDocument()
      expect(screen.queryByText('Stats are not available for this match yet.')).not.toBeInTheDocument()
      expect(screen.queryByText('Natus Vincere')).not.toBeInTheDocument()
    })

    it('shows only the one error when the stats fail as well', async () => {
      mockFetchRoutes({ [MATCH_URL]: NOT_FOUND, [STATS_URL]: NOT_FOUND })
      renderMatchPage()
      expect(await screen.findByText('Match not found')).toBeInTheDocument()
      expect(screen.getAllByText('Match not found')).toHaveLength(1)
      expect(screen.queryByText('Stats are not available for this match yet.')).not.toBeInTheDocument()
    })

    it('says FACEIT is unavailable on 502', async () => {
      mockFetchRoutes({ [MATCH_URL]: UNAVAILABLE, [STATS_URL]: UNAVAILABLE })
      renderMatchPage()
      expect(await screen.findByText('FACEIT is temporarily unavailable. Try again later.')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('shows a generic message for any other error', async () => {
      mockFetchRoutes({ [MATCH_URL]: BROKEN, [STATS_URL]: BROKEN })
      renderMatchPage()
      expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })
  })

  it('renders a sparse match without a map, a date, a status or a winner', async () => {
    const sparse: MatchResponse = {
      ...match,
      mapName: null,
      status: null,
      startedAt: null,
      finishedAt: null,
      winner: null,
      teams: [],
    }
    const undecided: MatchStatsResponse = {
      ...stats,
      mapName: null,
      teams: [team({ win: false, name: null }), team({ teamId: 't2', win: false, name: null, players: [] })],
    }
    mockFetchRoutes({ [MATCH_URL]: { body: sparse }, [STATS_URL]: { body: undecided } })
    const { container } = renderMatchPage()

    const header = (await screen.findByText('Unknown map')).closest('[data-slot="card"]') as HTMLElement
    expect(header).not.toBeNull()
    expect(container.querySelector('time')).toBeNull()
    expect(within(header).queryByText(/null|undefined|Invalid/)).not.toBeInTheDocument()
    expect(header.querySelector('[data-slot="match-status"]')).toBeNull()
    expect(await screen.findAllByRole('table')).toHaveLength(2)
    expect(screen.queryByText('Winner')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2, name: 'Team' })).toHaveLength(2)
    expect(container.textContent).not.toMatch(/null|undefined|Invalid/)
  })

  it('shows not-found without a request when the route has no match id', () => {
    const fetchMock = mockFetchRoutes({})
    renderWithProviders(<MatchPage />, { route: '/matches' })
    expect(screen.getByText('Match not found')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Match' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
