import { useQuery } from '@tanstack/react-query'
import { type ApiError, apiGet } from './client'
import type { EditorSource } from './editorTypes'
import { retryUnlessClientError } from './queries'

// The read of the montage editor. It sits beside `queries.ts`, as breakdown.ts does; the order of a montage is there,
// beside the compilation's, because it shares what a clip order does with its answer.
export type {
  EditorHighlight,
  EditorKill,
  EditorLimits,
  EditorRound,
  EditorSource,
  MontageAspect,
  MontageRequest,
  MontageSegment,
  MusicTrack,
} from './editorTypes'

/**
 * The player's kills in the match, by round, with the tick rate and the rules of a montage. The backend answers 404
 * `MATCH_NOT_FOUND` or `PLAYER_NOT_IN_MATCH`, and 409 `DEMO_NOT_AVAILABLE` while the demo has not been analyzed.
 */
export function useEditorSource(matchId: string, playerId: string) {
  return useQuery<EditorSource, ApiError>({
    queryKey: ['match-editor', matchId, playerId],
    queryFn: () => apiGet<EditorSource>(`/matches/${matchId}/editor`, { playerId }),
    retry: retryUnlessClientError,
    // The draft is checked against the source when the page opens; a source asked for again while the editor is open
    // changes nothing the visitor has done.
    staleTime: Infinity,
  })
}
