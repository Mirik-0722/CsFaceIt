package io.csfaceit.backend.analysis.highlight;

/**
 * A highlight a detector found, before it is stored.
 *
 * @param type what kind of highlight it is
 * @param playerId the {@code players.id} of the player it belongs to
 * @param roundNumber the round it happened in
 * @param firstTick the first tick of the event itself, for instance the first kill of a multi-kill or the tick a clutch
 *         began
 * @param lastTick the last tick of the event, no earlier than {@code firstTick}; a single kill has the same tick in
 *         both. The lead-in and the tail of the clip are not part of them: they are added around these two when the
 *         highlight is stored (see {@code AnalysisPersistence}).
 */
public record HighlightCandidate(HighlightType type, long playerId, int roundNumber, int firstTick, int lastTick) {
}
