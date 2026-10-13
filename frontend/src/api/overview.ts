import {
  type InfiniteData,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { refreshMe } from './auth'
import { type ApiError, apiGet, apiPost, apiUpload } from './client'
import type { PlayerMatchPageResponse, PlayerOverviewResponse } from './overviewTypes'
import { invalidateDemoResults, retryUnlessClientError } from './queries'
import type { DemoResponse, DemoStatus } from './types'

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
 * How often the list is asked for again while a clip of one of its matches is on its way to a video, so that the count
 * of clips in progress does not stay what it was when the page was opened. The clips page asks every three seconds; a
 * list of matches that is only a summary of them can wait longer.
 */
export const CLIPS_POLL_MS = 15_000

/**
 * How often the list is asked for again while the demo of one of its matches is on its way (queued, stored or parsed),
 * so that the row follows the stages without the page being reloaded.
 */
export const DEMOS_POLL_MS = 5_000

/** A demo that nothing has finished with yet: it is being fetched, read or analyzed. */
export function isDemoInProgress(status: DemoStatus | null): boolean {
  return status === 'QUEUED' || status === 'STORED' || status === 'PARSED'
}

/**
 * A player's matches with their demos, highlights and clips, one page of `limit` at a time, as `usePlayerHistory` pages
 * the history: `fetchNextPage` appends the page that starts at `offset + limit`, and a page shorter than `limit` is the
 * last one. While a loaded match has a demo on its way the pages are asked for again every 5 seconds, and while one has
 * a clip in progress every 15.
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
    // Only while some loaded match has a demo or a clip on its way; a list without one is not asked for again by itself.
    refetchInterval: (query) => {
      const items = query.state.data?.pages.flatMap((page) => page.items) ?? []
      if (items.some((match) => isDemoInProgress(match.demoStatus))) {
        return DEMOS_POLL_MS
      }
      return items.some((match) => match.clips.active > 0) ? CLIPS_POLL_MS : false
    },
    retry: retryUnlessClientError,
  })
}

/** What the backend answers to the sync of the visitor's matches: whether it is on at all, and how many it queued. */
interface SyncResponse {
  enabled: boolean
  queued: number
}

/**
 * Asks the backend, once when the page of the visitor's own matches opens, to fetch the demos of the matches that
 * have none (it does it where the site has been given FACEIT's access to them). It is a help and not part of the page:
 * an answer that is a failure (FACEIT not linked, no connection) is ignored. When it queued something the list is asked
 * for again, so that the rows it found show their stages.
 */
export function useSyncMatches(playerId: string, enabled: boolean) {
  const queryClient = useQueryClient()
  // Once per player: a development server mounts every effect twice, and a second call would only repeat the first.
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || asked.current === playerId) {
      return
    }
    asked.current = playerId
    apiPost<SyncResponse>('/matches/sync')
      .then((answer) => {
        if (answer.queued > 0) {
          void queryClient.invalidateQueries({ queryKey: ['player-matches', playerId] })
        }
      })
      .catch(() => undefined)
  }, [enabled, playerId, queryClient])
}

/** Takes the answer of a request that brought a demo in: the demo as it is now, and the rows that show it. */
function takeInDemo(queryClient: ReturnType<typeof useQueryClient>, matchId: string, demo: DemoResponse) {
  queryClient.setQueryData<DemoResponse | null>(['demo', matchId], demo)
  invalidateDemoResults(queryClient, matchId)
  void queryClient.invalidateQueries({ queryKey: ['player-matches'] })
}

/**
 * Uploads a demo file for a match of the list, as the signed-in player and with `onProgress` told how far it is. The
 * match is in the variables, not in the hook, because a file that is dropped anywhere on the page names its own match.
 */
export function useBringDemoFile() {
  const queryClient = useQueryClient()
  return useMutation<DemoResponse, ApiError, { matchId: string; file: File; onProgress?: (percent: number) => void }>({
    mutationFn: ({ matchId, file, onProgress }) => {
      const body = new FormData()
      body.append('file', file)
      return apiUpload<DemoResponse>(`/matches/${matchId}/demo/upload`, { body, onProgress })
    },
    onSuccess: (demo, { matchId }) => takeInDemo(queryClient, matchId, demo),
    onSettled: () => refreshMe(queryClient),
  })
}

/** Has the backend fetch the demo a pasted link points to (the link's file must be the match's own demo). */
export function useBringDemoLink() {
  const queryClient = useQueryClient()
  return useMutation<DemoResponse, ApiError, { matchId: string; url: string }>({
    mutationFn: ({ matchId, url }) => apiPost<DemoResponse>(`/matches/${matchId}/demo/import`, { body: { url } }),
    // The variables hold the link, which carries a signature: dropped from the cache as soon as nothing observes it.
    gcTime: 0,
    onSuccess: (demo, { matchId }) => takeInDemo(queryClient, matchId, demo),
    onSettled: () => refreshMe(queryClient),
  })
}
