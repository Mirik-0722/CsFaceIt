package io.csfaceit.backend.faceit;

import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchHistory;
import io.csfaceit.backend.faceit.dto.FaceitMatchStats;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import io.csfaceit.backend.faceit.dto.FaceitPlayerMatchStats;

/**
 * The single entry point to FACEIT Data API v4. Nothing outside the {@code faceit} package knows the shape of
 * FACEIT's JSON.
 *
 * <p>Every method throws {@link FaceitNotFoundException} when FACEIT answers 404 and
 * {@link FaceitUnavailableException} when FACEIT cannot be used (429, 5xx, a rejected API key, a response without
 * a body or a connection failure that survived all retry attempts). A returned value is never {@code null}.
 */
public interface FaceitGateway {

    /** {@code GET /players?nickname=}. */
    FaceitPlayer findPlayerByNickname(String nickname);

    /**
     * {@code GET /players?game=cs2&game_player_id=}: the FACEIT player whose CS2 account is the given SteamID64. A
     * SteamID that no FACEIT player has linked is a {@link FaceitNotFoundException}.
     */
    FaceitPlayer findPlayerBySteamId(String steamId);

    /** {@code GET /players/{id}}. */
    FaceitPlayer getPlayer(String playerId);

    /** {@code GET /players/{id}/history?game=cs2&offset=&limit=}. */
    FaceitMatchHistory getHistory(String playerId, int offset, int limit);

    /**
     * {@code GET /players/{id}/games/cs2/stats?offset=&limit=&from=}: the player's own numbers and the map of each of
     * his CS2 matches, newest first. A match FACEIT keeps no statistics for (a cancelled one) is not in it, so its
     * positions do not line up exactly with those of {@link #getHistory}: join the two by match id.
     */
    FaceitPlayerMatchStats getPlayerMatchStats(String playerId, int offset, int limit);

    /** {@code GET /matches/{id}}. */
    FaceitMatch getMatch(String matchId);

    /** {@code GET /matches/{id}/stats}. */
    FaceitMatchStats getMatchStats(String matchId);
}
