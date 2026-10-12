package io.csfaceit.backend.analysis.api.dto;

import java.util.List;

/**
 * One round of a match whose demo has been analyzed. {@code number} counts from 1 and goes on through overtime.
 * {@code winnerSide} is {@code "CT"} or {@code "T"}, and {@code null} when the demo does not say who won the round.
 * {@code winnerPlayerIds} are the ids of the players who played the round on the winning side (their
 * {@code round_players} rows), in ascending order of the id, in the form the highlights give them: the FACEIT player
 * id, or {@code steam:<SteamID>} for a player the backend knows only from the demo. The list is empty without a
 * winner.
 */
public record BreakdownRound(int number, String winnerSide, List<String> winnerPlayerIds) {
}
