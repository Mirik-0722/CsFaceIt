package io.csfaceit.backend.match.dto;

import java.time.Instant;
import java.util.List;

/**
 * Match details. {@code mapName}, {@code startedAt}, {@code finishedAt}, {@code demoUrl} and {@code winner} are
 * {@code null} while FACEIT has not published them (a match that is still being set up or played).
 * {@code winner} is a faction key that matches {@link TeamResponse#factionId()}.
 */
public record MatchResponse(
        String matchId,
        String mapName,
        String status,
        Instant startedAt,
        Instant finishedAt,
        String demoUrl,
        List<TeamResponse> teams,
        String winner) {
}
