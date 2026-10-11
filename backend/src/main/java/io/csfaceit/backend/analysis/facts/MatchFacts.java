package io.csfaceit.backend.analysis.facts;

import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * The facts of one match, loaded by {@link FactsLoader}: {@code matchId} is {@code matches.id}, {@code tickRate} the
 * ticks per second of the demo, {@code rounds} the counted rounds by ascending round number.
 */
public record MatchFacts(long matchId, int tickRate, List<RoundFacts> rounds) {

    public MatchFacts {
        rounds = List.copyOf(rounds);
    }

    /** Everybody who played at least one round, in the order of their ids. */
    public Set<Long> players() {
        Set<Long> players = new TreeSet<>();
        for (RoundFacts round : rounds) {
            players.addAll(round.sides().keySet());
        }
        return Collections.unmodifiableSet(players);
    }
}
