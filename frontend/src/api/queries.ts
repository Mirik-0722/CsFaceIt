import { type InfiniteData, type QueryKey, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ApiError, apiGet } from './client'
import type {
  MatchHistoryResponse,
  MatchResponse,
  MatchStatsResponse,
  PlayerResponse,
} from './types'

/** A 4xx answer will not change on a repeat; any other failure (5xx, network, unexpected) is retried once. */
export function retryUnlessClientError(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false
  }
  return failureCount < 1
}

export function usePlayerSearch(nickname: string) {
  return useQuery<PlayerResponse, ApiError>({
    queryKey: ['player-search', nickname],
    queryFn: () => apiGet<PlayerResponse>('/players', { nickname }),
    enabled: nickname.length >= 2,
    retry: retryUnlessClientError,
  })
}

export function usePlayer(playerId: string) {
  return useQuery<PlayerResponse, ApiError>({
    queryKey: ['player', playerId],
    queryFn: () => apiGet<PlayerResponse>(`/players/${playerId}`),
    retry: retryUnlessClientError,
  })
}

/** How many matches the backend returns per history page. */
const HISTORY_PAGE_SIZE = 20

/**
 * A player's match history, one page of `limit` matches at a time; `fetchNextPage` appends the page that starts at
 * `offset + limit`. A page shorter than `limit` is the last one, so `hasNextPage` turns false.
 */
export function usePlayerHistory(playerId: string, limit = HISTORY_PAGE_SIZE) {
  return useInfiniteQuery<
    MatchHistoryResponse,
    ApiError,
    InfiniteData<MatchHistoryResponse, number>,
    QueryKey,
    number
  >({
    queryKey: ['player-history', playerId, limit],
    queryFn: ({ pageParam }) =>
      apiGet<MatchHistoryResponse>(`/players/${playerId}/history`, { offset: pageParam, limit }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.items.length < limit ? undefined : lastPageParam + limit,
    retry: retryUnlessClientError,
  })
}

export function useMatch(matchId: string) {
  return useQuery<MatchResponse, ApiError>({
    queryKey: ['match', matchId],
    queryFn: () => apiGet<MatchResponse>(`/matches/${matchId}`),
    retry: retryUnlessClientError,
  })
}

export function useMatchStats(matchId: string) {
  return useQuery<MatchStatsResponse, ApiError>({
    queryKey: ['match-stats', matchId],
    queryFn: () => apiGet<MatchStatsResponse>(`/matches/${matchId}/stats`),
    retry: retryUnlessClientError,
  })
}
