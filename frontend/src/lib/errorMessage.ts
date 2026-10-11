import { ApiError } from '@/api/client'
import { type Messages, messagesFor } from '@/i18n'

/** The English texts of the two "not found" errors, for code that has no `Messages` at hand. */
export const PLAYER_NOT_FOUND_MESSAGE = messagesFor('en').errors.playerNotFound
export const MATCH_NOT_FOUND_MESSAGE = messagesFor('en').errors.matchNotFound

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
