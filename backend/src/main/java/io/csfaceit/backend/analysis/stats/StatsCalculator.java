package io.csfaceit.backend.analysis.stats;

import io.csfaceit.backend.analysis.facts.DamageFact;
import io.csfaceit.backend.analysis.facts.KillFact;
import io.csfaceit.backend.analysis.facts.MatchFacts;
import io.csfaceit.backend.analysis.facts.RoundFacts;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Component;

/**
 * Computes the statistics of every player of a match from its facts. It is a pure function of the facts: nothing is
 * read or written, so the same facts always give the same numbers.
 *
 * <ul>
 *   <li>A kill counts for the killer only if it is a kill of an enemy: the killer is a player, is not the victim, and
 *       played the round on the other side than the victim ({@link RoundFacts#enemies}). A team kill, a kill of
 *       oneself and a death by the world or the bomb are deaths of the victim and nothing else.
 *   <li>{@code deaths} counts every row the player is the victim of. {@code headshots} counts the headshots among
 *       the kills. {@code assists} counts the rows the player assisted whose victim was his enemy.
 *   <li>{@code roundsPlayed} is the number of rounds the player is in the roster of.
 *   <li>{@code adr} is the damage the player did to enemies, per round played. Within a round every player starts
 *       with 100 health and the hits are taken in the order they happened; a hit takes no more than the health the
 *       victim had left, whoever the attacker was (so damage that a teammate or the world did earlier also lowers
 *       what an enemy can still take from the victim), and only what was taken from an enemy is the attacker's
 *       damage.
 *   <li>{@code won}: the team that wins the last round of the match has won the match. A player who is in the roster of
 *       the last round has won if his side is the winner of that round; for a player who is not, or when the round
 *       has no known winner, it is {@code null}.
 * </ul>
 */
@Component
public class StatsCalculator {

    /** The health every player starts a round with. */
    private static final int ROUND_START_HEALTH = 100;

    private static final int ADR_SCALE = 2;

    /**
     * @return the values of every player who played a round, by player id (ascending)
     */
    public Map<Long, PlayerMatchStatsValues> calculate(MatchFacts facts) {
        Map<Long, Tally> tallies = new TreeMap<>();
        for (Long player : facts.players()) {
            tallies.put(player, new Tally());
        }
        for (RoundFacts round : facts.rounds()) {
            for (Long player : round.sides().keySet()) {
                tallies.get(player).roundsPlayed++;
            }
            countKills(round, tallies);
            countDamage(round, tallies);
        }
        Map<Long, Boolean> won = winners(facts.rounds());

        Map<Long, PlayerMatchStatsValues> values = new TreeMap<>();
        tallies.forEach((player, tally) -> values.put(player, tally.toValues(won.get(player))));
        return values;
    }

    private static void countKills(RoundFacts round, Map<Long, Tally> tallies) {
        for (KillFact kill : round.kills()) {
            Tally victim = tallies.get(kill.victimId());
            if (victim != null) {
                victim.deaths++;
            }
            if (isEnemyKill(round, kill)) {
                Tally killer = tallies.get(kill.killerId());
                killer.kills++;
                if (kill.headshot()) {
                    killer.headshots++;
                }
            }
            if (round.enemies(kill.assisterId(), kill.victimId())) {
                tallies.get(kill.assisterId()).assists++;
            }
        }
    }

    private static boolean isEnemyKill(RoundFacts round, KillFact kill) {
        return kill.killerId() != null && kill.killerId().longValue() != kill.victimId()
                && round.enemies(kill.killerId(), kill.victimId());
    }

    private static void countDamage(RoundFacts round, Map<Long, Tally> tallies) {
        Map<Long, Integer> health = new HashMap<>();
        for (DamageFact hit : round.damages()) {
            int left = health.getOrDefault(hit.victimId(), ROUND_START_HEALTH);
            int taken = Math.min(Math.max(hit.damageHealth(), 0), left);
            health.put(hit.victimId(), left - taken);
            if (round.enemies(hit.attackerId(), hit.victimId())) {
                tallies.get(hit.attackerId()).damage += taken;
            }
        }
    }

    /** Who has won the match according to its last round; players who are not in the map are unknown. */
    private static Map<Long, Boolean> winners(List<RoundFacts> rounds) {
        Map<Long, Boolean> won = new HashMap<>();
        RoundFacts last = rounds.stream().max(Comparator.comparingInt(RoundFacts::roundNumber)).orElse(null);
        if (last == null || last.winnerSide() == null) {
            return won;
        }
        last.sides().forEach((player, side) -> won.put(player, side == last.winnerSide()));
        return won;
    }

    /** What is counted for one player while the rounds go by. */
    private static final class Tally {
        int kills;
        int deaths;
        int assists;
        int headshots;
        int damage;
        int roundsPlayed;

        PlayerMatchStatsValues toValues(Boolean won) {
            BigDecimal adr = roundsPlayed == 0 ? null
                    : BigDecimal.valueOf(damage).divide(BigDecimal.valueOf(roundsPlayed), ADR_SCALE,
                            RoundingMode.HALF_UP);
            return new PlayerMatchStatsValues(kills, deaths, assists, headshots, adr, roundsPlayed, won, null, null,
                    null, null, null);
        }
    }
}
