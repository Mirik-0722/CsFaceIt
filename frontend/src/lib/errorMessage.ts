import { ApiError } from '@/api/client'
import type { Messages } from '@/i18n'
import { nextPossible } from '@/lib/limits'
import type { DenialReason } from '@/lib/viewer'

/** The 403 codes the dictionary words under their own names (`access`). */
const ACCESS_CODES = ['FACEIT_NOT_LINKED', 'NOT_IN_MATCH', 'NOT_YOUR_PLAYER', 'NOT_YOUR_CLIP', 'CROSS_SITE_REQUEST'] as const

/** The 429 codes: each sentence says when the next request is possible (`limits`). */
const LIMIT_CODES = ['UPLOAD_LIMIT_REACHED', 'IMPORT_LIMIT_REACHED', 'CLIP_LIMIT_REACHED'] as const

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
    if (error.code === 'CLIP_NOT_FAILED') {
      return t.clip.errors.notFailed
    }
    if (error.code === 'DEMO_ALREADY_PARSED') {
      return t.demo.alreadyParsed
    }
    if (error.code === 'DEMO_LINK_INVALID') {
      return t.demo.linkInvalid
    }
    if (error.code === 'DEMO_LINK_HOST_NOT_ALLOWED') {
      return t.demo.linkHostNotAllowed
    }
    if (error.code === 'DEMO_LINK_MISMATCH') {
      return t.demo.linkMismatch
    }
    if (error.code === 'DEMO_ALREADY_ANALYZED') {
      return t.demo.alreadyAnalyzed
    }
    const limit = LIMIT_CODES.find((code) => code === error.code)
    if (limit) {
      return t.limits[limit](nextPossible(error.retryAt, t))
    }
    const access = ACCESS_CODES.find((code) => code === error.code)
    if (access) {
      return t.access[access]
    }
    // Any other refusal, also one without a JSON body (the server's plain answer to a cross-origin write).
    if (error.status === 403) {
      return t.access.notAllowed
    }
  }
  return t.errors.generic
}

/**
 * Why the signed-in visitor may not do something, with the way out, in the words of the backend's refusal for the same
 * reason. Null for a visitor who is not signed in: the admin key field is what that visitor is shown.
 */
export function denialText(reason: DenialReason | null, t: Messages): string | null {
  return reason === null || reason === 'SIGNED_OUT' ? null : t.access[reason]
}

/**
 * The wording of a failure reason that the backend gave a code, in the language of the dictionary `reasons`; null when
 * there is no code, or when it is one this page does not know (a newer backend): the caller then shows the backend's
 * own sentence.
 */
export function reasonText(code: string | null, reasons: Readonly<Record<string, string>>): string | null {
  return typeof code === 'string' && Object.hasOwn(reasons, code) ? reasons[code] : null
}
