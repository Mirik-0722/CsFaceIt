import { useMemo } from 'react'
import { useMe } from '@/api/auth'
import type { MeLimits, MeResponse } from '@/api/authTypes'
import type { ClipResponse, MatchResponse } from '@/api/types'

/**
 * The FACEIT player of the signed-in visitor: the id of the player the pages call "you" (the visitor's own highlights,
 * the row of the scoreboard, the result of a match, the way back to the visitor's matches). Null while nobody is
 * signed in, or while the account has no player linked: then nobody is "you", and everything that depends on it is
 * left out.
 */
export function useViewerPlayerId(): string | null {
  return useMe().data?.playerId ?? null
}

/**
 * Whether the visitor is signed in with an account that has no FACEIT player: the notice that says so stands under the
 * top bar, above the page's own content (on every page but the home page, which says it in its hero).
 */
export function useHasUnlinkedNotice(): boolean {
  return useMe().data?.playerId === null
}

/**
 * Why the signed-in visitor may not do something. `SIGNED_OUT` is the visitor nobody is signed in as: nothing is
 * allowed by a session, and the admin key is what is left. The others are the backend's own 403 codes, so the text of
 * a refusal the page foresaw and of one the backend gave are the same.
 */
export type DenialReason = 'SIGNED_OUT' | 'FACEIT_NOT_LINKED' | 'NOT_IN_MATCH' | 'NOT_YOUR_PLAYER' | 'NOT_YOUR_CLIP'

/** Whether the visitor may do something by the session alone, and the reason when not. */
export type Permission = { allowed: true; reason: null } | { allowed: false; reason: DenialReason }

const ALLOWED: Permission = { allowed: true, reason: null }

function denied(reason: DenialReason): Permission {
  return { allowed: false, reason }
}

/** What the pages know about the visitor, and what the visitor may do without the admin key. */
export interface Viewer {
  /**
   * Who is signed in is not known yet (the first answer of `/auth/me` is on its way): everything below reads as for a
   * visitor meanwhile, so whatever is shown to a visitor only (the admin key field) waits until this is false.
   */
  loading: boolean
  /** Somebody is signed in. False also while the answer is on its way, and when it failed. */
  signedIn: boolean
  /** The session is an administrator's: everything is allowed, and nothing is counted. */
  admin: boolean
  /** As {@link useViewerPlayerId}. */
  playerId: string | null
  /**
   * What is left of the day's limits; null when there is no limit to name (an administrator, a visitor, or a backend
   * that does not count yet).
   */
  limits: MeLimits | null
  /** The demo of a match: bring it, upload it, have it analyzed. For the players of the match. */
  canManageDemo: (match: Pick<MatchResponse, 'teams'>) => Permission
  /** A clip of that player's highlight, or the compilation of that player's kills. For the player. */
  canOrderFor: (playerId: string) => Permission
  /** Cancel, delete or retry a clip. For whoever ordered it, with or without a linked FACEIT player. */
  canManageClip: (clip: Pick<ClipResponse, 'mine'>) => Permission
}

/**
 * The rules of who may write what, as the backend applies them, worked out from `/auth/me`: the pages offer only what
 * will be accepted, and say why for the rest. The backend still decides; a refusal of something offered here is shown
 * with the same words. Not a hook itself, so that the rules can be read without a query client.
 */
export function viewerOf(me: MeResponse | null | undefined, loading = false): Viewer {
  const admin = me?.role === 'ADMIN'
  const playerId = me?.playerId ?? null
  /** What holds before the rule of the action itself: an administrator may, and a visitor without a player may not. */
  function general(): Permission | null {
    if (!me) {
      return denied('SIGNED_OUT')
    }
    if (admin) {
      return ALLOWED
    }
    return playerId === null ? denied('FACEIT_NOT_LINKED') : null
  }
  return {
    loading,
    signedIn: Boolean(me),
    admin,
    playerId,
    limits: me && !admin ? (me.limits ?? null) : null,
    canManageDemo: (match) =>
      general() ??
      (match.teams.some((team) => team.players.some((player) => player.playerId === playerId))
        ? ALLOWED
        : denied('NOT_IN_MATCH')),
    canOrderFor: (ofPlayerId) => general() ?? (ofPlayerId === playerId ? ALLOWED : denied('NOT_YOUR_PLAYER')),
    // The backend asks only who ordered the clip, so the owner manages it whether or not a FACEIT player is linked.
    // `=== true`: a backend that does not say whose a clip is yet leaves the field out.
    canManageClip: (clip) => {
      if (!me) {
        return denied('SIGNED_OUT')
      }
      return admin || clip.mine === true ? ALLOWED : denied('NOT_YOUR_CLIP')
    },
  }
}

/** The signed-in visitor and what the visitor may do: see {@link viewerOf}. */
export function useViewer(): Viewer {
  const { data: me, isPending } = useMe()
  return useMemo(() => viewerOf(me, isPending), [me, isPending])
}
