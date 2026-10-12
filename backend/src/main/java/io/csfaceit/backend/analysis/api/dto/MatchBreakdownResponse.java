package io.csfaceit.backend.analysis.api.dto;

import java.util.List;

/**
 * The breakdown of a match for its page: who won each round, and the numbers the analysis computed for each player.
 * {@code matchId} is the FACEIT match id of the request. Both lists are empty for a match the database does not know
 * and for one whose demo is not {@code ANALYZED}; {@code rounds} are by round number and {@code players} by id.
 */
public record MatchBreakdownResponse(String matchId, List<BreakdownRound> rounds, List<BreakdownPlayer> players) {
}
