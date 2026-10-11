package io.csfaceit.backend.analysis.highlight;

import io.csfaceit.backend.analysis.AnalysisProperties;
import io.csfaceit.backend.analysis.facts.MatchFacts;
import io.csfaceit.backend.analysis.facts.RoundFacts;
import io.csfaceit.backend.analysis.facts.Side;
import io.csfaceit.backend.analysis.timeline.RoundTimeline;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Finds the defuses that were completed while an enemy was still alive: the round has a defused bomb and a defuser who
 * played it, and at the tick the bomb was defused at least one player of the other side is alive (one who dies on that
 * very tick is not). The highlight belongs to the defuser and ends at the defuse; it starts
 * {@code analysis.ninja.defuse-seconds} before it, which is how long the defuse took.
 *
 * <p>This is a simplification of the idea of a ninja defuse, which also asks that no enemy was close when the defuse
 * began. The parser stores no position per tick, so the distance cannot be told, and a defuse that is completed with an
 * enemy alive but next to the bomb is a highlight here as well.
 */
@Component
public class NinjaDefuseDetector implements HighlightDetector {

    private final AnalysisProperties properties;

    public NinjaDefuseDetector(AnalysisProperties properties) {
        this.properties = properties;
    }

    @Override
    public List<HighlightCandidate> detect(MatchFacts facts) {
        long defuseTicks = (long) properties.ninja().defuseSeconds() * facts.tickRate();
        List<HighlightCandidate> found = new ArrayList<>();
        for (RoundFacts round : facts.rounds()) {
            Integer defusedAt = round.bombDefusedTick();
            Side defuserSide = round.defuserId() == null ? null : round.sides().get(round.defuserId());
            if (defusedAt == null || defuserSide == null) {
                continue;
            }
            if (!RoundTimeline.of(round).aliveAt(defuserSide.opposite(), defusedAt).isEmpty()) {
                found.add(new HighlightCandidate(HighlightType.NINJA_DEFUSE, round.defuserId(), round.roundNumber(),
                        (int) Math.max(0L, defusedAt - defuseTicks), defusedAt));
            }
        }
        return found;
    }
}
