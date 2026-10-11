import { ApiError } from '@/api/client'

export const PLAYER_NOT_FOUND_MESSAGE = 'Player not found'
export const MATCH_NOT_FOUND_MESSAGE = 'Match not found'

/** The text shown to the user for a failed request; anything the pages do not single out gets a generic message. */
export function errorMessage(error: Error): string {
  if (error instanceof ApiError) {
    if (error.code === 'PLAYER_NOT_FOUND') {
      return PLAYER_NOT_FOUND_MESSAGE
    }
    if (error.code === 'MATCH_NOT_FOUND') {
      return MATCH_NOT_FOUND_MESSAGE
    }
    if (error.code === 'FACEIT_UNAVAILABLE') {
      return 'FACEIT is temporarily unavailable. Try again later.'
    }
  }
  return 'Something went wrong. Try again.'
}
