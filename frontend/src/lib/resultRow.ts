import type { MatchResult } from '@/api/types'

/**
 * The classes of a row of matches that carries its result (the `result-row` utility: a bar at the left edge and a tint
 * that fades out); a match without a known result has neither. The word of the result stays in the row: the colour is
 * never the only sign. The matches table and the profile's history use it.
 */
export const RESULT_ROW: Record<MatchResult, string | undefined> = {
  WIN: 'result-row [--result:var(--positive)]',
  LOSS: 'result-row [--result:var(--negative)]',
  UNKNOWN: undefined,
}
