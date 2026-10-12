package io.csfaceit.backend.analysis.api.dto;

/**
 * What the analysis of the demo computed for one player of a match. {@code playerId} is the FACEIT player id, or
 * {@code steam:<SteamID>} for a player the backend knows only from the demo. {@code kast} is a percentage from 0 to
 * 100 with one decimal, as {@code PlayerAggregateStatsResponse} reports it. A figure the analysis did not compute is
 * {@code null}, never 0; {@code clutchWins} out of {@code clutchAttempts} are the clutches of the match.
 */
public record BreakdownPlayer(
        String playerId,
        Double kast,
        Integer entryKills,
        Integer tradeKills,
        Integer clutchWins,
        Integer clutchAttempts) {
}
