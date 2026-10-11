package io.csfaceit.backend.analysis.api.dto;

import io.csfaceit.backend.analysis.highlight.HighlightType;
import java.time.Instant;
import java.util.List;

/**
 * One highlight of one player in one round of a match whose demo has been analyzed.
 *
 * <p>{@code playerId} is the FACEIT player id, or {@code steam:<SteamID>} for a player the backend knows only from the
 * demo; {@code matchId} is the FACEIT match id. {@code side} is the side the player played the round on, {@code "CT"}
 * or {@code "T"}, and {@code null} when the facts of the demo do not say (a demo parsed before the roster of a round
 * was recorded). The clip is {@code tickStart..tickEnd}, inside the round {@code roundStartTick..roundEndTick}, and
 * {@code durationSeconds} is its length rounded to whole seconds. {@code kills} are the player's kills of an enemy in
 * that window, in the order they happened (a team kill, a kill of oneself and a death by the world are not kills);
 * the list is empty when the window holds none. {@code mapName} and {@code startedAt} are the match's and {@code null}
 * while it has none.
 */
public record HighlightResponse(
        long id,
        HighlightType type,
        String playerId,
        String nickname,
        int roundNumber,
        String side,
        int tickStart,
        int tickEnd,
        int roundStartTick,
        int roundEndTick,
        int durationSeconds,
        List<HighlightKill> kills,
        String matchId,
        String mapName,
        Instant startedAt) {
}
