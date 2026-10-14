// Where a match and a player come from, from their public ids alone (the twins of the backend's `MatchSource` and
// `PlayerService.isSteamPlayerId`): the pages can tell before any answer has arrived, and with a backend that does not
// name the source yet.

/** The start of the id of every Valve matchmaking match: `mm-<Valve match id>`. */
const MATCHMAKING_PREFIX = 'mm-'

/** The start of the id of a player known only from demos: `steam:<SteamID>`. */
const STEAM_PLAYER_PREFIX = 'steam:'

/** Whether the match is a Valve matchmaking match (Premier, Competitive, Wingman), which FACEIT knows nothing of. */
export function isMatchmakingMatch(matchId: string): boolean {
  return matchId.startsWith(MATCHMAKING_PREFIX)
}

/** Whether the player is known only from demos: no FACEIT profile, no FACEIT history. */
export function isSteamPlayer(playerId: string): boolean {
  return playerId.startsWith(STEAM_PLAYER_PREFIX)
}

/** The id of the player a SteamID stands for while FACEIT does not know it. */
export function steamPlayerId(steamId: string): string {
  return `${STEAM_PLAYER_PREFIX}${steamId}`
}

/**
 * The page of the signed-in visitor's own matches: the FACEIT player's, else, for an account without FACEIT, the one
 * its SteamID is known by (its matchmaking matches, and the CS2 link). Null for nobody, and for an account with neither.
 * The colon of `steam:` stays as it is (it is allowed in a path, and the SteamID is digits): the address bar shows it
 * so, and a navigation link compares its path with the address as written to tell that it is the current page.
 */
export function ownMatchesPath(
  me: { playerId: string | null; steamId: string | null } | null | undefined,
): string | null {
  if (me?.playerId) {
    return `/players/${encodeURIComponent(me.playerId)}/matches`
  }
  return me?.steamId ? `/players/${STEAM_PLAYER_PREFIX}${encodeURIComponent(me.steamId)}/matches` : null
}
