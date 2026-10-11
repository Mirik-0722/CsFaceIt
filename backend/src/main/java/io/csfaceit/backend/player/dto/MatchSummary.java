package io.csfaceit.backend.player.dto;

import java.time.Instant;
import java.util.Map;

/** One line of a player's match history; {@code score} is keyed by faction ({@code faction1}, {@code faction2}). */
public record MatchSummary(
        String matchId,
        Instant startedAt,
        Instant finishedAt,
        MatchResult result,
        Map<String, Integer> score) {
}
