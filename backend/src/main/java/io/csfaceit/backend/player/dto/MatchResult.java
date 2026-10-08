package io.csfaceit.backend.player.dto;

/** The outcome of a match for one player; {@code UNKNOWN} when it cannot be determined from the history item. */
public enum MatchResult {
    WIN,
    LOSS,
    UNKNOWN
}
