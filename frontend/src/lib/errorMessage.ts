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
    if (error.code === 'DEMO_URL_UNAVAILABLE') {
      return t.demo.urlUnavailable
    }
    if (error.code === 'DEMO_NOT_PARSED') {
      return t.demo.notParsed
    }
    if (error.code === 'PAYLOAD_TOO_LARGE') {
      return t.demo.tooLarge
    }
    if (error.code === 'CLIP_NOT_FOUND') {
      return t.clip.notFound
    }
    if (error.code === 'HIGHLIGHT_NOT_FOUND') {
      return t.clip.errors.highlightGone
    }
    if (error.code === 'DEMO_NOT_AVAILABLE') {
      return t.clip.errors.demoGone
    }
    if (error.code === 'PLAYER_STEAM_ID_UNKNOWN') {
      return t.clip.errors.steamIdUnknown
    }
    if (error.code === 'CLIP_QUEUE_FULL') {
      return t.clip.errors.queueFull
    }
    if (error.code === 'CLIP_TOO_LONG') {
      return t.clip.errors.tooLong
    }
    if (error.code === 'NO_KILLS') {
      return t.clip.errors.noKills
    }
    if (error.code === 'CLIP_IN_PROGRESS') {
      return t.clip.errors.inProgress
    }
  }
  return t.errors.generic
}

/**
 * The wording of a failure reason that the backend gave a code, in the language of the dictionary `reasons`; null when
 * there is no code, or when it is one this page does not know (a newer backend): the caller then shows the backend's
 * own sentence.
 */
export function reasonText(code: string | null, reasons: Readonly<Record<string, string>>): string | null {
  return typeof code === 'string' && Object.hasOwn(reasons, code) ? reasons[code] : null
}
