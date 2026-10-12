package io.csfaceit.backend.player.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * One match of a player's FACEIT history together with what the backend has stored of it. {@code matchId},
 * {@code startedAt}, {@code finishedAt}, {@code result} and {@code score} are those of the history line
 * ({@link MatchSummary}); the rest comes from the database:
 *
 * <ul>
 *   <li>{@code mapName}: {@code null} while the match is not stored or has no map yet.
 *   <li>{@code kills}, {@code deaths}, {@code assists}: the player's own numbers, {@code null} while there is no row of
 *       statistics for him in this match.
 *   <li>{@code adr}: the player's damage per round with one decimal, and only when the match was analyzed from a demo;
 *       {@code null} otherwise.
 *   <li>{@code demoStatus}: the status of the match's demo as the demo endpoints name it ({@code ANALYZED} and so on),
 *       {@code null} when the match has no demo.
 *   <li>{@code highlights}: the player's highlights in this match by type, the most frequent type first, then by name;
 *       empty while the demo is not {@code ANALYZED} (a highlight is served only then) or the player has none.
 *   <li>{@code clips}: the clips of this match that follow the player.
 * </ul>
 */
public record PlayerMatchResponse(
        String matchId,
        String mapName,
        Instant startedAt,
        Instant finishedAt,
        MatchResult result,
        Map<String, Integer> score,
        Integer kills,
        Integer deaths,
        Integer assists,
        Double adr,
        String demoStatus,
        List<HighlightCount> highlights,
        ClipCounts clips) {
}
