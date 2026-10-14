package io.csfaceit.backend.match.dto;

import io.csfaceit.backend.match.MatchSource;
import java.time.Instant;
import java.util.List;

/**
 * Match details. {@code mapName}, {@code startedAt}, {@code finishedAt}, {@code demoUrl} and {@code winner} are
 * {@code null} while FACEIT has not published them (a match that is still being set up or played).
 * {@code winner} is a faction key that matches {@link TeamResponse#factionId()}.
 *
 * <p>{@code source} says where the match comes from. A {@link MatchSource#MATCHMAKING} match is answered from its demo
 * (see {@code DemoScoreboard}): {@code faction1} is the team that started the match on CT, {@code faction2} the one that
 * started on T, both empty until the demo is parsed; {@code winner} follows the rounds won, and {@code demoUrl} is
 * {@code null}.
 */
public record MatchResponse(
        String matchId,
        String mapName,
        String status,
        Instant startedAt,
        Instant finishedAt,
        String demoUrl,
        List<TeamResponse> teams,
        String winner,
        MatchSource source) {
}
