import { useQuery } from '@tanstack/react-query'
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

export function usePlayerHistory(playerId: string, offset = 0, limit = 20) {
  return useQuery<MatchHistoryResponse, ApiError>({
    queryKey: ['player-history', playerId, offset, limit],
    queryFn: () => apiGet<MatchHistoryResponse>(`/players/${playerId}/history`, { offset, limit }),
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
