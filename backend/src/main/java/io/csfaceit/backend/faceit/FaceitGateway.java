package io.csfaceit.backend.faceit;

import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchHistory;
import io.csfaceit.backend.faceit.dto.FaceitMatchStats;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;

/**
 * The single entry point to FACEIT Data API v4. Nothing outside the {@code faceit} package knows the shape of
 * FACEIT's JSON.
 *
 * <p>Every method throws {@link FaceitNotFoundException} when FACEIT answers 404 and
 * {@link FaceitUnavailableException} when FACEIT cannot be used (429, 5xx, a rejected API key or a connection
 * failure that survived all retry attempts).
 */
public interface FaceitGateway {

    /** {@code GET /players?nickname=}. */
    FaceitPlayer findPlayerByNickname(String nickname);

    /** {@code GET /players/{id}}. */
    FaceitPlayer getPlayer(String playerId);

    /** {@code GET /players/{id}/history?game=cs2&offset=&limit=}. */
    FaceitMatchHistory getHistory(String playerId, int offset, int limit);

    /** {@code GET /matches/{id}}. */
    FaceitMatch getMatch(String matchId);

    /** {@code GET /matches/{id}/stats}. */
    FaceitMatchStats getMatchStats(String matchId);
}
