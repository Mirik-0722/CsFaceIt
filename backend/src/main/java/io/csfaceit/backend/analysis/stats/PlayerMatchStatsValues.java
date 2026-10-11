package io.csfaceit.backend.analysis.stats;

import java.math.BigDecimal;

/**
 * What the analysis found out about one player in one match; the fields are those of {@code player_match_stats}.
 * {@code adr} has two decimals. {@code won} is {@code null} when the demo does not say whether the player's team won.
 * The last five fields are filled by the round timeline; a statistic that was not computed is {@code null}, never 0.
 */
public record PlayerMatchStatsValues(
        int kills,
        int deaths,
        int assists,
        int headshots,
        BigDecimal adr,
        int roundsPlayed,
        Boolean won,
        BigDecimal kast,
        Integer entryKills,
        Integer tradeKills,
        Integer clutchAttempts,
        Integer clutchWins) {
}
