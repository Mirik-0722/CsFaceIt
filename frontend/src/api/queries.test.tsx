import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
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

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient()
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePlayerSearch', () => {
  it('does not call the API for a nickname shorter than two characters', () => {
    vi.stubGlobal('fetch', vi.fn())
    const { result } = renderHook(() => usePlayerSearch('s'), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('searches by nickname once it has two characters', async () => {
    const player = { playerId: 'p1', nickname: 's1', avatar: null, country: null, elo: null, level: null }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(player))))
    const { result } = renderHook(() => usePlayerSearch('s1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(player))
    expect(fetch).toHaveBeenCalledWith('/api/v1/players?nickname=s1', expect.anything())
  })
})

describe('query hooks', () => {
  const hookCases: [string, () => UseQueryResult<unknown>, string][] = [
    ['usePlayer', () => usePlayer('p1'), '/api/v1/players/p1'],
    ['usePlayerHistory', () => usePlayerHistory('p1'), '/api/v1/players/p1/history?offset=0&limit=20'],
    ['usePlayerHistory with a page', () => usePlayerHistory('p1', 40, 10), '/api/v1/players/p1/history?offset=40&limit=10'],
    ['useMatch', () => useMatch('1-m1'), '/api/v1/matches/1-m1'],
    ['useMatchStats', () => useMatchStats('1-m1'), '/api/v1/matches/1-m1/stats'],
  ]

  it.each(hookCases)('%s requests %s', async (_name, useHook, url) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))))
    const { result } = renderHook(useHook, { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetch).toHaveBeenCalledWith(url, expect.anything())
  })

  it('does not retry a 404', async () => {
    const notFound = { code: 'PLAYER_NOT_FOUND', message: 'x' }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(notFound), { status: 404 }))))
    const { result } = renderHook(() => usePlayer('missing'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 404, code: 'PLAYER_NOT_FOUND' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
