import { useMe } from '@/api/auth'

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
