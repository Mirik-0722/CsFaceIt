import { ApiError } from '@/api/client'
import type { Messages } from '@/i18n'

/**
 * The text shown to the user for a failed request, in the language of `t`; anything the pages do not single out gets
 * a generic message.
 */
export function errorMessage(error: Error, t: Messages): string {
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
    if (error.code === 'UNAUTHORIZED') {
      return t.demo.wrongKey
    }
    if (error.code === 'DEMO_URL_UNAVAILABLE') {
      return t.demo.urlUnavailable
    }
    if (error.code === 'DEMO_NOT_PARSED') {
      return t.demo.notParsed
    }
    if (error.code === 'PAYLOAD_TOO_LARGE') {
      return t.demo.tooLarge
    }
  }
  return t.errors.generic
}
