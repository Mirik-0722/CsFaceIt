package io.csfaceit.backend.player.dto;

/**
 * How a player did on one map, over the matches of his that the backend has stored. {@code wins} counts the matches
 * whose result is known to be a win. {@code kd} is the kills over the deaths of those matches with two decimals (over
 * 1 when the player never died there), and {@code adr} the mean of the ADR of the matches that were analyzed from a
 * demo, with one decimal; it is {@code null} while none of them was.
 */
public record MapResult(String mapName, int matches, int wins, double kd, Double adr) {
}
