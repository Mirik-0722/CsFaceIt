import {
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { isFinished } from '@/lib/clipStatus'
import { ApiError, apiDelete, apiGet, apiPost } from './client'
import type {
  ClipPageResponse,
  ClipQuality,
  ClipResponse,
  DemoResponse,
  HighlightPageResponse,
  HighlightResponse,
  HighlightType,
  MatchHistoryResponse,
  MatchResponse,
  MatchStatsResponse,
  PlayerAggregateStatsResponse,
  PlayerResponse,
  RecorderStatusResponse,
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

/** A demo that this page has seen unchanged for this long is taken to be one that nothing is working on. */
const DEMO_STALLED_MS = 30 * 60 * 1000

/**
 * The last stamp (status and write time) of the demo of each match that this page has seen, and when it first saw it.
 * The server's time is never compared with the browser's clock, which may be set to anything; only two readings of
 * the browser's own clock are.
 */
const demoSightings = new Map<string, { stamp: string; since: number }>()

/**
 * True while the pipeline will move the demo on by itself: queued, stored, or parsed with its analysis to come. A
 * demo that this page has seen in the same such state for half an hour is not being worked on (one parsed before
 * analyses existed stays PARSED for good), so it does not count: asking about it every three seconds would never end.
 * A new stamp restarts the half hour. Asking again about the same stamp changes nothing.
 */
function isInProgress(matchId: string, demo: DemoResponse | null | undefined): boolean {
  if (!demo) {
    return false
  }
  const moving = demo.status === 'QUEUED' || demo.status === 'STORED' || (demo.status === 'PARSED' && !demo.error)
  if (!moving) {
    return false
  }
  const stamp = `${demo.status} ${demo.updatedAt}`
  const now = Date.now()
  const seen = demoSightings.get(matchId)
  if (seen?.stamp !== stamp) {
    demoSightings.set(matchId, { stamp, since: now })
    return true
  }
  return now - seen.since <= DEMO_STALLED_MS
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
    refetchInterval: (query) => (watching || isInProgress(matchId, query.state.data) ? DEMO_POLL_MS : false),
    retry: retryUnlessClientError,
  })
}

/** Everything that is computed from a demo: asked for again when the demo of a match has changed. */
export function invalidateDemoResults(queryClient: QueryClient, matchId: string) {
  void queryClient.invalidateQueries({ queryKey: ['match-highlights', matchId] })
  void queryClient.invalidateQueries({ queryKey: ['match-breakdown', matchId] })
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
    // The variables hold the admin key. A finished request is dropped from the cache as soon as nothing observes it,
    // not five minutes later; the hook of a mounted panel still observes it, so a rejected key is cleared there (see
    // DemoPanel).
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

/** How often clips are asked for again while one of them is still on its way to a video. */
const CLIP_POLL_MS = 3000

/** How often the recorder is asked about: it counts as offline only after a minute and a half of silence. */
const RECORDER_POLL_MS = 60_000

/** How many clips the backend returns per page of a clip list. */
const CLIPS_PAGE_SIZE = 12

/** A clip that is neither done nor failed will change by itself, so a list that holds one is asked for again. */
function pollWhileUnfinished(clips: ClipResponse[] | undefined): number | false {
  return clips?.some((clip) => !isFinished(clip.status)) ? CLIP_POLL_MS : false
}

/** Every clip of a match, in whatever state, newest first; an empty list for a match without clips. */
export function useMatchClips(matchId: string) {
  return useQuery<ClipResponse[], ApiError>({
    queryKey: ['match-clips', matchId],
    queryFn: () => apiGet<ClipResponse[]>(`/matches/${matchId}/clips`),
    refetchInterval: (query) => pollWhileUnfinished(query.state.data),
    retry: retryUnlessClientError,
  })
}

/**
 * A player's clips, in whatever state, newest first, one page of `limit` at a time, as {@link usePlayerHistory} pages
 * the history.
 */
export function usePlayerClips(playerId: string, limit = CLIPS_PAGE_SIZE) {
  return useInfiniteQuery<ClipPageResponse, ApiError, InfiniteData<ClipPageResponse, number>, QueryKey, number>({
    queryKey: ['player-clips', playerId, limit],
    queryFn: ({ pageParam }) =>
      apiGet<ClipPageResponse>(`/players/${playerId}/clips`, { offset: pageParam, limit }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.items.length < limit ? undefined : lastPageParam + limit,
    refetchInterval: (query) => pollWhileUnfinished(query.state.data?.pages.flatMap((page) => page.items)),
    retry: retryUnlessClientError,
  })
}

/** The finished clips of every player, newest first, paged like {@link usePlayerClips}. */
export function useRecentClips(limit = CLIPS_PAGE_SIZE) {
  return useInfiniteQuery<ClipPageResponse, ApiError, InfiniteData<ClipPageResponse, number>, QueryKey, number>({
    queryKey: ['recent-clips', limit],
    queryFn: ({ pageParam }) => apiGet<ClipPageResponse>('/clips', { offset: pageParam, limit }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.items.length < limit ? undefined : lastPageParam + limit,
    retry: retryUnlessClientError,
  })
}

/**
 * One clip with its kills; asked for again every three seconds until it is done or failed, or until the backend says
 * that there is no such clip (any more): a clip that waits can be withdrawn while its page is open somewhere else.
 */
export function useClip(clipId: number) {
  return useQuery<ClipResponse, ApiError>({
    queryKey: ['clip', clipId],
    queryFn: () => apiGet<ClipResponse>(`/clips/${clipId}`),
    refetchInterval: (query) =>
      query.state.error?.status === 404 ? false : pollWhileUnfinished(query.state.data && [query.state.data]),
    retry: retryUnlessClientError,
  })
}

/** Whether a recorder is online and how long the queue is, asked for again every minute. */
export function useRecorderStatus() {
  return useQuery<RecorderStatusResponse, ApiError>({
    queryKey: ['recorder-status'],
    queryFn: () => apiGet<RecorderStatusResponse>('/recorder/status'),
    refetchInterval: RECORDER_POLL_MS,
    retry: retryUnlessClientError,
  })
}

/** Every list a clip can be in, and the queue it changes: asked for again when a clip was requested or deleted. */
function invalidateClipLists(queryClient: QueryClient, matchId: string) {
  void queryClient.invalidateQueries({ queryKey: ['match-clips', matchId] })
  void queryClient.invalidateQueries({ queryKey: ['player-clips'] })
  void queryClient.invalidateQueries({ queryKey: ['recent-clips'] })
  void queryClient.invalidateQueries({ queryKey: ['recorder-status'] })
}

/**
 * The requests that change a clip are sent even when the browser thinks it is offline: they then fail at once and
 * the page says so. Held back until the connection returns (the default), they would leave the order dialog, which
 * cannot be closed while its request is on its way, and the confirmation of a deletion waiting with it.
 */
const SEND_AT_ONCE = { networkMode: 'always' } as const

/**
 * What both requests for a clip do with their answer: the clip goes to the head of the list of its match at once, so
 * the page shows it before the lists have been asked for again.
 */
function takeInRequestedClip(queryClient: QueryClient, clip: ClipResponse) {
  queryClient.setQueryData<ClipResponse[]>(['match-clips', clip.matchId], (clips) =>
    clips ? [clip, ...clips.filter((other) => other.id !== clip.id)] : clips,
  )
  invalidateClipLists(queryClient, clip.matchId)
}

/**
 * Asks for the clip of a highlight. The answer is the clip as it is now (a new one in the queue, or the one that
 * already exists for that highlight and quality); it goes into the list of its match at once, so the page shows it
 * before the list has been asked for again.
 */
export function useRequestHighlightClip() {
  const queryClient = useQueryClient()
  return useMutation<ClipResponse, ApiError, { apiKey: string; highlightId: number; quality: ClipQuality }>({
    mutationFn: ({ apiKey, highlightId, quality }) =>
      apiPost<ClipResponse>(`/highlights/${highlightId}/clips`, { apiKey, body: { quality } }),
    // The variables hold the admin key: see useDemoAction.
    gcTime: 0,
    ...SEND_AT_ONCE,
    onSuccess: (clip) => takeInRequestedClip(queryClient, clip),
  })
}

/**
 * Asks for the compilation of a player's kills in a match: one video of every kill. Answered and cached like
 * {@link useRequestHighlightClip}; a player without a kill in the demo is refused (409 `NO_KILLS`).
 */
export function useRequestCompilation() {
  const queryClient = useQueryClient()
  return useMutation<
    ClipResponse,
    ApiError,
    { apiKey: string; matchId: string; playerId: string; quality: ClipQuality }
  >({
    mutationFn: ({ apiKey, matchId, playerId, quality }) =>
      apiPost<ClipResponse>(`/matches/${matchId}/clips`, { apiKey, body: { playerId, quality } }),
    gcTime: 0,
    ...SEND_AT_ONCE,
    onSuccess: (clip) => takeInRequestedClip(queryClient, clip),
  })
}

/** Deletes a clip and its files. A clip that is being recorded cannot be deleted (409 `CLIP_IN_PROGRESS`). */
export function useDeleteClip() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, { apiKey: string; clip: ClipResponse }>({
    mutationFn: ({ apiKey, clip }) => apiDelete(`/clips/${clip.id}`, { apiKey }),
    gcTime: 0,
    ...SEND_AT_ONCE,
    onSuccess: (_nothing, { clip }) => {
      queryClient.removeQueries({ queryKey: ['clip', clip.id] })
      invalidateClipLists(queryClient, clip.matchId)
    },
  })
}
