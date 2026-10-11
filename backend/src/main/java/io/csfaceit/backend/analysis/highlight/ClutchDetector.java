package io.csfaceit.backend.analysis.highlight;

import io.csfaceit.backend.analysis.facts.MatchFacts;
import io.csfaceit.backend.analysis.facts.RoundFacts;
import io.csfaceit.backend.analysis.facts.Side;
import io.csfaceit.backend.analysis.timeline.ClutchAttempt;
import io.csfaceit.backend.analysis.timeline.RoundTimeline;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Finds the clutches that were won: for each side of each round, the attempt {@link RoundTimeline#clutch} reports, when
 * the side won the round. A lost attempt is no highlight; it only counts in the statistics. The highlight is named for
 * the number of enemies alive when the player was left alone ({@code CLUTCH_1V3} for three) and lasts from that tick to
 * the tick the round was decided at.
 */
@Component
public class ClutchDetector implements HighlightDetector {

    /** By the number of enemies minus one; an attempt reports no more than {@link ClutchAttempt#MAX_ENEMIES}. */
    private static final List<HighlightType> TYPES = List.of(HighlightType.CLUTCH_1V1, HighlightType.CLUTCH_1V2,
            HighlightType.CLUTCH_1V3, HighlightType.CLUTCH_1V4, HighlightType.CLUTCH_1V5);

    @Override
    public List<HighlightCandidate> detect(MatchFacts facts) {
        List<HighlightCandidate> found = new ArrayList<>();
        for (RoundFacts round : facts.rounds()) {
            RoundTimeline timeline = RoundTimeline.of(round);
            for (Side side : Side.values()) {
                timeline.clutch(side).filter(ClutchAttempt::won).ifPresent(attempt ->
                        found.add(new HighlightCandidate(TYPES.get(attempt.enemiesAlive() - 1), attempt.playerId(),
                                attempt.roundNumber(), attempt.tick(), round.decidedTick())));
            }
        }
        return found;
    }
}
