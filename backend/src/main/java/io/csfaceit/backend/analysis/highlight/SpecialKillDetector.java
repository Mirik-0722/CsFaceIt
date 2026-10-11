package io.csfaceit.backend.analysis.highlight;

import io.csfaceit.backend.analysis.facts.KillFact;
import io.csfaceit.backend.analysis.facts.MatchFacts;
import io.csfaceit.backend.analysis.facts.RoundFacts;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Finds the single kills that are worth a clip of their own. Every kill of an enemy (see {@link RoundFacts#enemies}) is
 * looked at on its own, and one kill can be several highlights, each a candidate of its own at the tick of the kill:
 * <ul>
 *   <li>{@link HighlightType#KNIFE_KILL}: the weapon's name starts with {@code knife} or is {@code bayonet};
 *   <li>{@link HighlightType#NO_SCOPE}: the parser flagged the kill {@code noscope} and the weapon is a sniper rifle
 *       ({@code awp}, {@code ssg08}, {@code g3sg1} or {@code scar20});
 *   <li>{@link HighlightType#WALLBANG}: the parser flagged it {@code wallbang};
 *   <li>{@link HighlightType#SMOKE_KILL}: the parser flagged it {@code thrusmoke}.
 * </ul>
 * A team kill, a kill of oneself and a death by the world or the bomb are no highlights of any kind. Weapon names are
 * compared without regard to case.
 */
@Component
public class SpecialKillDetector implements HighlightDetector {

    private static final String KNIFE_PREFIX = "knife";

    private static final String BAYONET = "bayonet";

    private static final Set<String> SNIPER_RIFLES = Set.of("awp", "ssg08", "g3sg1", "scar20");

    @Override
    public List<HighlightCandidate> detect(MatchFacts facts) {
        List<HighlightCandidate> found = new ArrayList<>();
        for (RoundFacts round : facts.rounds()) {
            for (KillFact kill : round.kills()) {
                if (!round.enemies(kill.killerId(), kill.victimId())) {
                    continue;
                }
                String weapon = kill.weapon() == null ? "" : kill.weapon().toLowerCase(Locale.ROOT);
                if (weapon.startsWith(KNIFE_PREFIX) || weapon.equals(BAYONET)) {
                    found.add(candidate(HighlightType.KNIFE_KILL, round, kill));
                }
                if (kill.noscope() && SNIPER_RIFLES.contains(weapon)) {
                    found.add(candidate(HighlightType.NO_SCOPE, round, kill));
                }
                if (kill.wallbang()) {
                    found.add(candidate(HighlightType.WALLBANG, round, kill));
                }
                if (kill.thrusmoke()) {
                    found.add(candidate(HighlightType.SMOKE_KILL, round, kill));
                }
            }
        }
        return found;
    }

    private static HighlightCandidate candidate(HighlightType type, RoundFacts round, KillFact kill) {
        return new HighlightCandidate(type, kill.killerId(), round.roundNumber(), kill.tick(), kill.tick());
    }
}
