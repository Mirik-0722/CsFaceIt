import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { ApiError } from './client'
import {
  retryUnlessClientError,
  useMatch,
  useMatchStats,
  usePlayer,
  usePlayerHistory,
  usePlayerSearch,
} from './queries'

describe('retryUnlessClientError', () => {
  it.each([400, 404, 429, 499])('does not retry a %i response', (status) => {
    expect(retryUnlessClientError(0, new ApiError(status, 'ANY', 'x'))).toBe(false)
  })

  it.each([
    ['a 502 response', new ApiError(502, 'FACEIT_UNAVAILABLE', 'x')],
    ['a 500 response', new ApiError(500, 'INTERNAL_ERROR', 'x')],
    ['a network failure', new ApiError(0, 'NETWORK_ERROR', 'x')],
    ['an unexpected error', new Error('boom')],
  ])('retries %s once', (_name, error) => {
    expect(retryUnlessClientError(0, error)).toBe(true)
    expect(retryUnlessClientError(1, error)).toBe(false)
    expect(retryUnlessClientError(2, error)).toBe(false)
  })
})

function Wrapper({ children }: { children: ReactNode }) {
  // One client per mounted wrapper: a client created on every render would drop the cache whenever the hook re-renders.
  const [client] = useState(() => new QueryClient())
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePlayerSearch', () => {
  it('does not call the API for a nickname shorter than two characters', () => {
    vi.stubGlobal('fetch', vi.fn())
    const { result } = renderHook(() => usePlayerSearch('s'), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('searches by nickname once it has two characters', async () => {
    const player = { playerId: 'p1', nickname: 's1', avatar: null, country: null, elo: null, level: null }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(player))))
    const { result } = renderHook(() => usePlayerSearch('s1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.data).toEqual(player))
    expect(fetch).toHaveBeenCalledWith('/api/v1/players?nickname=s1', expect.anything())
  })
})

describe('usePlayerHistory', () => {
  function historyPage(offset: number, count: number, limit = 20) {
    const items = Array.from({ length: count }, (_, i) => ({
      matchId: `m${offset + i}`,
      startedAt: '2026-10-01T10:00:00Z',
      finishedAt: '2026-10-01T10:45:00Z',
      result: 'WIN',
      score: { faction1: 13, faction2: 9 },
    }))
    return new Response(JSON.stringify({ items, offset, limit }))
  }

  it('requests the first page from offset 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(historyPage(0, 20)))
    const { result } = renderHook(() => usePlayerHistory('p1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/v1/players/p1/history?offset=0&limit=20', expect.anything())
  })

  it('requests the next page at offset + limit and keeps every page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(historyPage(0, 20))
      .mockResolvedValueOnce(historyPage(20, 20))
      .mockResolvedValueOnce(historyPage(40, 5))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => usePlayerHistory('p1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))

    void result.current.fetchNextPage()
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/players/p1/history?offset=20&limit=20', expect.anything())
    expect(result.current.hasNextPage).toBe(true)

    void result.current.fetchNextPage()
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(3))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/players/p1/history?offset=40&limit=20', expect.anything())
    expect(result.current.data?.pages.map((page) => page.items.length)).toEqual([20, 20, 5])
    expect(result.current.hasNextPage).toBe(false)
  })

  it('has no next page when the first page is short', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(historyPage(0, 19)))
    const { result } = renderHook(() => usePlayerHistory('p1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.hasNextPage).toBe(false)
  })

  it('has no next page when there are no matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(historyPage(0, 0)))
    const { result } = renderHook(() => usePlayerHistory('p1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.hasNextPage).toBe(false)
  })

  it('uses a custom page size for the limit and the next offset', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(historyPage(0, 10, 10))
      .mockResolvedValueOnce(historyPage(10, 3, 10))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => usePlayerHistory('p1', 10), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/players/p1/history?offset=0&limit=10', expect.anything())

    void result.current.fetchNextPage()
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/players/p1/history?offset=10&limit=10', expect.anything())
    expect(result.current.hasNextPage).toBe(false)
  })
})

describe('query hooks', () => {
  const hookCases: [string, () => UseQueryResult<unknown>, string][] = [
    ['usePlayer', () => usePlayer('p1'), '/api/v1/players/p1'],
    ['useMatch', () => useMatch('1-m1'), '/api/v1/matches/1-m1'],
    ['useMatchStats', () => useMatchStats('1-m1'), '/api/v1/matches/1-m1/stats'],
  ]

  it.each(hookCases)('%s requests %s', async (_name, useHook, url) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))))
    const { result } = renderHook(useHook, { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetch).toHaveBeenCalledWith(url, expect.anything())
  })

  it('does not retry a 404', async () => {
    const notFound = { code: 'PLAYER_NOT_FOUND', message: 'x' }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(notFound), { status: 404 }))))
    const { result } = renderHook(() => usePlayer('missing'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 404, code: 'PLAYER_NOT_FOUND' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
