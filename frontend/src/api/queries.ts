import {
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ApiError, apiGet, apiPost } from './client'
import type {
  DemoResponse,
  HighlightPageResponse,
  HighlightResponse,
  HighlightType,
  MatchHistoryResponse,
  MatchResponse,
  MatchStatsResponse,
  PlayerAggregateStatsResponse,
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

/** How often the demo is asked for again while the backend is still working on it. */
const DEMO_POLL_MS = 3000

/** A demo that has not changed for this long is taken to be one that nothing is working on. */
const DEMO_STALLED_MS = 30 * 60 * 1000

/**
 * True while the pipeline will move the demo on by itself: queued, stored, or parsed with its analysis to come. A
 * demo that has stood in such a state for half an hour is not being worked on (one parsed before analyses existed
 * stays PARSED for good), so it does not count: asking about it every three seconds would never end.
 */
function isInProgress(demo: DemoResponse | null | undefined): boolean {
  if (!demo) {
    return false
  }
  const moving = demo.status === 'QUEUED' || demo.status === 'STORED' || (demo.status === 'PARSED' && !demo.error)
  // An unreadable time compares false, which keeps the demo in progress.
  return moving && !(Date.now() - Date.parse(demo.updatedAt) > DEMO_STALLED_MS)
}

/**
 * The demo of a match, or `null` when the match has none (the backend's 404 `DEMO_NOT_FOUND` is a state, not an
 * error). While the pipeline is working on the demo it is asked for again every three seconds; `watching` does the
 * same for a demo that looks settled, after a request whose effect shows only later (a repeated analysis).
 */
export function useDemo(matchId: string, watching = false) {
  return useQuery<DemoResponse | null, ApiError>({
    queryKey: ['demo', matchId],
    queryFn: async () => {
      try {
        return await apiGet<DemoResponse>(`/matches/${matchId}/demo`)
      } catch (error) {
        if (error instanceof ApiError && error.code === 'DEMO_NOT_FOUND') {
          return null
        }
        throw error
      }
    },
    refetchInterval: (query) => (watching || isInProgress(query.state.data) ? DEMO_POLL_MS : false),
    retry: retryUnlessClientError,
  })
}

/** Everything that is computed from a demo: asked for again when the demo of a match has changed. */
export function invalidateDemoResults(queryClient: QueryClient, matchId: string) {
  void queryClient.invalidateQueries({ queryKey: ['match-highlights', matchId] })
  void queryClient.invalidateQueries({ queryKey: ['player-highlights'] })
  void queryClient.invalidateQueries({ queryKey: ['player-stats'] })
}

/** A demo request that needs the admin key; its answer is the demo as it is now, which replaces the cached one. */
function useDemoAction<Variables extends { apiKey: string }>(
  matchId: string,
  send: (variables: Variables) => Promise<DemoResponse>,
) {
  const queryClient = useQueryClient()
  return useMutation<DemoResponse, ApiError, Variables>({
    mutationFn: send,
    // The variables hold the admin key: the cache drops a finished request at once instead of after five minutes.
    gcTime: 0,
    onSuccess: (demo) => {
      queryClient.setQueryData<DemoResponse | null>(['demo', matchId], demo)
      invalidateDemoResults(queryClient, matchId)
    },
  })
}

/** Has the backend download the demo of the match from FACEIT. */
export function useImportDemo(matchId: string) {
  return useDemoAction(matchId, ({ apiKey }: { apiKey: string }) =>
    apiPost<DemoResponse>(`/matches/${matchId}/demo/import`, { apiKey }),
  )
}

/** Uploads a demo file for the match; the part is named `file`, as the backend expects. */
export function useUploadDemo(matchId: string) {
  return useDemoAction(matchId, ({ apiKey, file }: { apiKey: string; file: File }) => {
    const body = new FormData()
    body.append('file', file)
    return apiPost<DemoResponse>(`/matches/${matchId}/demo/upload`, { apiKey, body })
  })
}

/** Has the parsed demo of the match analyzed again. The analysis runs in the background. */
export function useAnalyzeDemo(matchId: string) {
  return useDemoAction(matchId, ({ apiKey }: { apiKey: string }) =>
    apiPost<DemoResponse>(`/matches/${matchId}/demo/analyze`, { apiKey }),
  )
}

/** Every highlight of a match, in round order; an empty list when the match has no analyzed demo. */
export function useMatchHighlights(matchId: string) {
  return useQuery<HighlightResponse[], ApiError>({
    queryKey: ['match-highlights', matchId],
    queryFn: () => apiGet<HighlightResponse[]>(`/matches/${matchId}/highlights`),
    retry: retryUnlessClientError,
  })
}

/** How many highlights the backend returns per page of a player's highlights. */
const HIGHLIGHTS_PAGE_SIZE = 50

/**
 * A player's highlights, newest match first, one page of `limit` at a time, as {@link usePlayerHistory} pages the
 * history. `type` narrows the list to one kind on the server; `null` is every kind.
 */
export function usePlayerHighlights(playerId: string, type: HighlightType | null, limit = HIGHLIGHTS_PAGE_SIZE) {
  return useInfiniteQuery<
    HighlightPageResponse,
    ApiError,
    InfiniteData<HighlightPageResponse, number>,
    QueryKey,
    number
  >({
    queryKey: ['player-highlights', playerId, type, limit],
    queryFn: ({ pageParam }) =>
      apiGet<HighlightPageResponse>(`/players/${playerId}/highlights`, {
        ...(type ? { type } : {}),
        offset: pageParam,
        limit,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.items.length < limit ? undefined : lastPageParam + limit,
    retry: retryUnlessClientError,
  })
}

/** A player's statistics over the matches the backend has stored. */
export function usePlayerStats(playerId: string) {
  return useQuery<PlayerAggregateStatsResponse, ApiError>({
    queryKey: ['player-stats', playerId],
    queryFn: () => apiGet<PlayerAggregateStatsResponse>(`/players/${playerId}/stats`),
    retry: retryUnlessClientError,
  })
}
