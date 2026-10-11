package io.csfaceit.backend.analysis.api.dto;

/**
 * A player's statistics over the matches the backend has stored. {@code matches} is how many matches have a row for
 * the player and {@code analyzedMatches} how many of them were analyzed from a demo. Percentages are 0 to 100 with one
 * decimal; {@code kd} and the two per-match figures have two decimals and {@code adr} one.
 *
 * <p>A figure with no data behind it is {@code null}, never 0: {@code winRate} while no result of the player is known,
 * {@code adr} while no ADR is stored, {@code kast} and the two per-match figures while no match was analyzed, and
 * {@code clutchPercent} while the player had no clutch. {@code kd} and {@code hsPercent} are 0 for a player with no
 * deaths or no kills, and {@code clutchAttempts} and {@code clutchWins} are 0 when there is nothing to count. A player
 * the backend does not know has {@code matches} 0 and every nullable figure {@code null}.
 */
public record PlayerAggregateStatsResponse(
        String playerId,
        int matches,
        int analyzedMatches,
        Double winRate,
        double kd,
        double hsPercent,
        Double adr,
        Double kast,
        Double entryKillsPerMatch,
        Double tradeKillsPerMatch,
        Double clutchPercent,
        int clutchAttempts,
        int clutchWins) {
}
