import { useQuery } from '@tanstack/react-query'
import { type ApiError, apiGet } from './client'
import type { MatchBreakdownResponse } from './breakdownTypes'
import { retryUnlessClientError } from './queries'

// The read that feeds the round strip and the analysis columns of the match page. It sits beside `queries.ts`, not in
// it, so that the files other work is changing stay as they are; its answer is in `breakdownTypes.ts`.
export type { BreakdownPlayer, BreakdownRound, MatchBreakdownResponse, RoundSide } from './breakdownTypes'

/**
 * The rounds of a match and what the demo analysis computed per player; both lists are empty without an analyzed demo.
 */
export function useMatchBreakdown(matchId: string) {
  return useQuery<MatchBreakdownResponse, ApiError>({
    queryKey: ['match-breakdown', matchId],
    queryFn: () => apiGet<MatchBreakdownResponse>(`/matches/${matchId}/breakdown`),
    retry: retryUnlessClientError,
  })
}
