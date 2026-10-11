package io.csfaceit.backend.analysis.timeline;

/**
 * A clutch: the moment a player became the last of his side alive while at least one enemy still lived (see
 * {@link RoundTimeline#clutch}).
 *
 * @param playerId the {@code players.id} of the player who was left alone
 * @param roundNumber the round it happened in
 * @param tick the tick of the death that left him alone
 * @param enemiesAlive how many enemies were alive at that tick, from 1 to {@value #MAX_ENEMIES}: more than that is
 *         reported as {@value #MAX_ENEMIES}, because a clutch is never rated beyond a 1v5
 * @param won whether the player's side won the round, also when he died after the attempt began
 */
public record ClutchAttempt(long playerId, int roundNumber, int tick, int enemiesAlive, boolean won) {

    /** The most enemies an attempt reports; the clutch highlights go from 1v1 up to 1v5. */
    public static final int MAX_ENEMIES = 5;
}
