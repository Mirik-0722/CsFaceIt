import { type InfiniteData, type QueryKey, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { type ApiError, apiGet } from './client'
import type { PlayerMatchPageResponse, PlayerOverviewResponse } from './overviewTypes'
import { retryUnlessClientError } from './queries'

// The two reads that feed the player's page and the page of the player's matches. They sit beside `queries.ts`, not in
// it, so that the files other work is changing stay as they are; their answers are in `overviewTypes.ts`.
export type {
  ClipCounts,
  HighlightCount,
  MapOverview,
  PlayerMatchPageResponse,
  PlayerMatchResponse,
  PlayerOverviewResponse,
} from './overviewTypes'

/** The player's stored matches by map, and the player's highlights by type. */
export function usePlayerOverview(playerId: string) {
  return useQuery<PlayerOverviewResponse, ApiError>({
    queryKey: ['player-overview', playerId],
    queryFn: () => apiGet<PlayerOverviewResponse>(`/players/${playerId}/overview`),
    retry: retryUnlessClientError,
  })
}

/** How many matches the backend returns per page of a player's matches. */
const MATCHES_PAGE_SIZE = 20

/**
 * A player's matches with their demos, highlights and clips, one page of `limit` at a time, as `usePlayerHistory` pages
 * the history: `fetchNextPage` appends the page that starts at `offset + limit`, and a page shorter than `limit` is the
 * last one.
 */
export function usePlayerMatches(playerId: string, limit = MATCHES_PAGE_SIZE) {
  return useInfiniteQuery<
    PlayerMatchPageResponse,
    ApiError,
    InfiniteData<PlayerMatchPageResponse, number>,
    QueryKey,
    number
  >({
    queryKey: ['player-matches', playerId, limit],
    queryFn: ({ pageParam }) =>
      apiGet<PlayerMatchPageResponse>(`/players/${playerId}/matches`, { offset: pageParam, limit }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.items.length < limit ? undefined : lastPageParam + limit,
    retry: retryUnlessClientError,
  })
}
