package io.csfaceit.backend.analysis.highlight;

import io.csfaceit.backend.analysis.facts.KillFact;
import io.csfaceit.backend.analysis.facts.MatchFacts;
import io.csfaceit.backend.analysis.facts.RoundFacts;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import org.springframework.stereotype.Component;

/**
 * Finds the rounds in which one player killed several enemies: an {@link HighlightType#ACE} for five or more, a
 * {@link HighlightType#K4} for exactly four and a {@link HighlightType#K3} for exactly three. A player has at most one
 * of them per round, the highest, so a four-kill round is no K3 as well.
 *
 * <p>Only the kills of an enemy are counted (see {@link RoundFacts#enemies}): a team kill, a kill of oneself and a
 * death by the world or the bomb are not. The highlight lasts from the first of those kills to the last.
 */
@Component
public class MultiKillDetector implements HighlightDetector {

    /** The kills of one round that make an ace, which is also what any number above it makes. */
    private static final int ACE_KILLS = 5;

    private static final int K4_KILLS = 4;

    private static final int K3_KILLS = 3;

    @Override
    public List<HighlightCandidate> detect(MatchFacts facts) {
        List<HighlightCandidate> found = new ArrayList<>();
        for (RoundFacts round : facts.rounds()) {
            // The kills of the round are in the order they happened, so those of one killer are as well.
            Map<Long, List<KillFact>> killsByKiller = new TreeMap<>();
            for (KillFact kill : round.kills()) {
                if (round.enemies(kill.killerId(), kill.victimId())) {
                    killsByKiller.computeIfAbsent(kill.killerId(), killer -> new ArrayList<>()).add(kill);
                }
            }
            killsByKiller.forEach((killer, kills) -> typeOf(kills.size()).ifPresent(type ->
                    found.add(new HighlightCandidate(type, killer, round.roundNumber(), kills.get(0).tick(),
                            kills.get(kills.size() - 1).tick()))));
        }
        return found;
    }

    private static Optional<HighlightType> typeOf(int kills) {
        if (kills >= ACE_KILLS) {
            return Optional.of(HighlightType.ACE);
        }
        if (kills == K4_KILLS) {
            return Optional.of(HighlightType.K4);
        }
        if (kills == K3_KILLS) {
            return Optional.of(HighlightType.K3);
        }
        return Optional.empty();
    }
}
