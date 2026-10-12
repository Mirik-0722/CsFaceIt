/**
 * The FACEIT player of the signed-in visitor: the id of the player the pages call "you" (the visitor's own highlights,
 * the row of the scoreboard, the result of a match, the way back to the visitor's matches). Null while nobody is
 * signed in, or while the account has no player linked. Signing in lands separately and will supply the value; until
 * then nobody is "you", and everything that depends on it is left out.
 */
export function useViewerPlayerId(): string | null {
  return null
}
