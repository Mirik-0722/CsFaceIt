import { ApiError } from '@/api/client'
import { type Messages, messagesFor } from '@/i18n'

/**
 * The text shown to the user for a failed request, in the language of `t` (English when none is given); anything the
 * pages do not single out gets a generic message.
 */
export function errorMessage(error: Error, t: Messages = messagesFor('en')): string {
  if (error instanceof ApiError) {
    if (error.code === 'PLAYER_NOT_FOUND') {
      return t.errors.playerNotFound
    }
    if (error.code === 'MATCH_NOT_FOUND') {
      return t.errors.matchNotFound
    }
    if (error.code === 'FACEIT_UNAVAILABLE') {
      return t.errors.faceitUnavailable
    }
  }
  return t.errors.generic
}
