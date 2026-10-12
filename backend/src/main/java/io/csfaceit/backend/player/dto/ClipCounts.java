package io.csfaceit.backend.player.dto;

/**
 * The clips of one match that follow one player, by where they are: {@code done} are finished, {@code active} are
 * still on their way to a video (waiting in the queue, being recorded, encoded or uploaded) and {@code failed} have
 * been given up.
 */
public record ClipCounts(int done, int active, int failed) {
}
