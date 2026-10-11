package io.csfaceit.backend.analysis.facts;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Everything the parser recorded about one round, with every id a {@code players.id}.
 *
 * <p>{@code sides} is the roster of the round: who played it and on which side. It comes from
 * {@code round_players} and, for a player the roster does not list, from the sides the kill events of the round
 * name (a player who died before the first sampled position, say); where the two disagree, the roster wins. A player
 * who is not in {@code sides} did not play the round: he is not counted among the living, in the denominator of a
 * per-round figure or in {@code roundsPlayed}.
 *
 * <p>{@code decidedTick} is {@code rounds.decided_tick}, or {@code endTick} for a round parsed before that fact was
 * recorded; a bound that mentions it is inclusive ("up to and including"), because the kill that decides a round
 * falls on that very tick. {@code winnerSide} is {@code null} when the parser did not name the winner. The lists
 * are in {@code (tick, id)} order, which is the order things happened in.
 */
public record RoundFacts(
        int roundNumber,
        Side winnerSide,
        int startTick,
        int endTick,
        int decidedTick,
        Integer bombPlantedTick,
        Integer bombDefusedTick,
        Long defuserId,
        Map<Long, Side> sides,
        List<KillFact> kills,
        List<DamageFact> damages) {

    /** Keeps the lists and the roster as they were handed over, in a form nobody can change afterwards. */
    public RoundFacts {
        sides = Collections.unmodifiableMap(new TreeMap<>(sides));
        kills = List.copyOf(kills);
        damages = List.copyOf(damages);
    }

    /**
     * Whether the two players played this round on different sides. A player who is not in the roster, and
     * {@code null}, is nobody's enemy. {@code HighlightQueryService.KILLS_SQL} is the SQL copy of this rule and must
     * change with it.
     */
    public boolean enemies(Long a, Long b) {
        if (a == null || b == null) {
            return false;
        }
        Side sideOfA = sides.get(a);
        Side sideOfB = sides.get(b);
        return sideOfA != null && sideOfB != null && sideOfA != sideOfB;
    }

    /** The players of the roster who played {@code side}, in the order of their ids. */
    public Set<Long> players(Side side) {
        Set<Long> players = new TreeSet<>();
        sides.forEach((player, playerSide) -> {
            if (playerSide == side) {
                players.add(player);
            }
        });
        return Collections.unmodifiableSet(players);
    }
}
