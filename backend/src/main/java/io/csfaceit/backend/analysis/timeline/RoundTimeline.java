package io.csfaceit.backend.analysis.timeline;

import io.csfaceit.backend.analysis.facts.KillFact;
import io.csfaceit.backend.analysis.facts.RoundFacts;
import io.csfaceit.backend.analysis.facts.Side;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

/**
 * Who was alive at which tick of one round. It is a pure function of the {@link RoundFacts}.
 *
 * <p>At the start of the round everybody in the roster ({@link RoundFacts#sides}) is alive. The deaths are the rows of
 * {@code kills}, whoever caused them (an enemy, a teammate, the player himself, the world or the bomb), and a player
 * is dead from the tick of his first death on. The deaths of one tick happen together: nobody is alive "in between".
 * A player the roster does not list did not play the round and is never alive, and a death row of his is ignored.
 */
public final class RoundTimeline {

    private final RoundFacts round;
    /** The tick of the first death of every roster player who died in the round. */
    private final Map<Long, Integer> diedAt;

    private RoundTimeline(RoundFacts round, Map<Long, Integer> diedAt) {
        this.round = round;
        this.diedAt = diedAt;
    }

    public static RoundTimeline of(RoundFacts round) {
        Map<Long, Integer> diedAt = new HashMap<>();
        for (KillFact kill : round.kills()) {
            if (round.sides().containsKey(kill.victimId())) {
                diedAt.merge(kill.victimId(), kill.tick(), Math::min);
            }
        }
        return new RoundTimeline(round, Map.copyOf(diedAt));
    }

    /**
     * @return the players of {@code side} who have not died by {@code tick}; one who dies on {@code tick} itself is
     *         already dead. In the order of their ids.
     */
    public Set<Long> aliveAt(Side side, int tick) {
        Set<Long> alive = new TreeSet<>();
        for (Long player : round.players(side)) {
            Integer died = diedAt.get(player);
            if (died == null || died > tick) {
                alive.add(player);
            }
        }
        return Collections.unmodifiableSet(alive);
    }

    /**
     * The clutch of a side: the moment its living players fall from more than one to exactly one, if at least one
     * enemy is alive then and the moment is no later than the tick the round was decided at (that tick included). The
     * tick of the attempt is the tick of the death that left the player alone, and the enemies are counted at that
     * tick.
     *
     * <p>There is no attempt when the side goes from several players to none at once, when it was a single player from
     * the start of the round, when the enemy has nobody left at that moment, and when the player is left alone only
     * after the round was decided (a bomb that exploded, say, and the seconds after it, in which players can still be
     * killed). {@code won} is whether the side won the round, also if the player died after the moment; a round
     * without a known winner is not won by anybody.
     *
     * <p>A side has at most one attempt in a round (the number of players alive only ever falls), and when both sides
     * are down to one player each of them has one.
     */
    public Optional<ClutchAttempt> clutch(Side side) {
        int alive = round.players(side).size();
        for (int tick : new TreeSet<>(diedAt.values())) {
            if (tick > round.decidedTick()) {
                break;
            }
            Set<Long> own = aliveAt(side, tick);
            int enemies = aliveAt(side.opposite(), tick).size();
            if (alive >= 2 && own.size() == 1 && enemies >= 1) {
                return Optional.of(new ClutchAttempt(own.iterator().next(), round.roundNumber(), tick,
                        Math.min(enemies, ClutchAttempt.MAX_ENEMIES), round.winnerSide() == side));
            }
            alive = own.size();
        }
        return Optional.empty();
    }
}
