import {
  type InfiniteData,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { isSteamPlayer } from '@/lib/matchSource'
import { refreshMe } from './auth'
import { type ApiError, apiGet, apiPost, apiUpload } from './client'
import type { PlayerMatchPageResponse, PlayerMatchResponse, PlayerOverviewResponse } from './overviewTypes'
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
 * How long a demo may stay PARSED on one page before the page stops counting it as in progress: a demo that the
 * analysis never takes up would otherwise keep the list asking for ever. The backend gives the row no time of its own,
 * so it is the page's first sight of the row that counts.
 */
export const PARSED_STALLED_MS = 30 * 60_000

/** When this page first saw a row in a status, by `matchId:status`: only the PARSED ones are kept. */
export type ParsedSeen = Map<string, number>

/**
 * Notes the PARSED rows that this page has not seen yet as seen at `now`, and forgets the row that is seen in any other
 * status: a demo that is uploaded again and reaches PARSED once more gets its 30 minutes anew.
 */
export function noteParsedRows(seen: ParsedSeen, items: PlayerMatchResponse[], now: number): void {
  for (const match of items) {
    const key = `${match.matchId}:PARSED`
    if (match.demoStatus !== 'PARSED') {
      seen.delete(key)
    } else if (!seen.has(key)) {
      seen.set(key, now)
    }
  }
}

/** Whether a PARSED row has been so for `PARSED_STALLED_MS` on this page: it is then shown as nothing is going on. */
export function isParsedStalled(seen: ParsedSeen, match: PlayerMatchResponse, now: number): boolean {
  const since = match.demoStatus === 'PARSED' ? seen.get(`${match.matchId}:PARSED`) : undefined
  return since !== undefined && now - since >= PARSED_STALLED_MS
}

/**
 * Where a page of a player's matches starts: the `offset` into the FACEIT history, and `before`, the start of the last
 * row of the page before it (null for the first page). The backend shows the person's matchmaking matches of a page's
 * stretch of time with it, and needs `before` to know where that stretch ends.
 */
export interface MatchesPageParam {
  offset: number
  before: string | null
}

/**
 * A player's matches with their demos, highlights and clips, one page of `limit` at a time, as `usePlayerHistory` pages
 * the history: `fetchNextPage` appends the page that starts at `offset + limit`, and a page shorter than `limit` is the
 * last one. Matchmaking matches come merged into a page of FACEIT matches (so a page may hold more rows than `limit`):
 * the next page is asked for with `before`, the start of the last row loaded. A player known only from demos
 * (`steam:<SteamID>`) has matchmaking matches alone, paged by `offset`, and is asked for without `before`. On the
 * visitor's own page (`own`) the pages are asked for again every 5 seconds while a loaded match has a demo on its way,
 * except a PARSED one that has been so for 30 minutes (`seen` holds when each was first seen); on any page they are asked
 * for every 15 seconds while a loaded match has a clip in progress.
 */
export function usePlayerMatches(
  playerId: string,
  limit = MATCHES_PAGE_SIZE,
  own = false,
  seen: ParsedSeen | null = null,
) {
  return useInfiniteQuery<
    PlayerMatchPageResponse,
    ApiError,
    InfiniteData<PlayerMatchPageResponse, MatchesPageParam>,
    QueryKey,
    MatchesPageParam
  >({
    queryKey: ['player-matches', playerId, limit],
    queryFn: ({ pageParam }) =>
      apiGet<PlayerMatchPageResponse>(`/players/${playerId}/matches`, {
        offset: pageParam.offset,
        limit,
        ...(pageParam.before === null ? {} : { before: pageParam.before }),
      }),
    initialPageParam: { offset: 0, before: null },
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      // The FACEIT rows of a page are at most `limit`; the matchmaking rows merged in come on top of them. A page that
      // has fewer rows than `limit` in all is the last one either way.
      if (lastPage.items.length < limit) {
        return undefined
      }
      const last = lastPage.items[lastPage.items.length - 1]
      return {
        offset: lastPageParam.offset + limit,
        before: isSteamPlayer(playerId) ? null : last.startedAt,
      }
    },
    // Only while some loaded match has a demo or a clip on its way; a list without one is not asked for again by itself.
    refetchInterval: (query) => {
      const items = query.state.data?.pages.flatMap((page) => page.items) ?? []
      const now = Date.now()
      if (seen) {
        noteParsedRows(seen, items, now)
      }
      const demoOnItsWay = items.some(
        (match) => isDemoInProgress(match.demoStatus) && !(seen && isParsedStalled(seen, match, now)),
      )
      if (own && demoOnItsWay) {
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
