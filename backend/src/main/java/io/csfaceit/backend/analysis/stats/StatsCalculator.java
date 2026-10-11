package io.csfaceit.backend.analysis.stats;

import io.csfaceit.backend.analysis.AnalysisProperties;
import io.csfaceit.backend.analysis.facts.DamageFact;
import io.csfaceit.backend.analysis.facts.KillFact;
import io.csfaceit.backend.analysis.facts.MatchFacts;
import io.csfaceit.backend.analysis.facts.RoundFacts;
import io.csfaceit.backend.analysis.facts.Side;
import io.csfaceit.backend.analysis.timeline.RoundTimeline;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
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
 *   <li>{@code entryKills} is the number of rounds in which the player made the first kill of an enemy, the first by
 *       {@code (tick, id)}: a round has at most one, and a team kill, a kill of oneself or a death by the world is
 *       not a kill, so it never opens a round.
 *   <li>{@code tradeKills}: a kill of an enemy (killer B, victim X) is a trade if X killed a teammate V of B (V is
 *       not B) in the same round, at most the trade window before it or on its tick. A kill counts once however
 *       many teammates of B its victim had killed in that time, and each of them has his death traded.
 *   <li>{@code kast} is the share of the rounds played, in percent, in which the player had a kill (K), an assist
 *       (A, counted as for {@code assists}), survived (S: no kill row of the round has him as its victim, whoever
 *       caused the death and whenever it happened) or had his death traded (T).
 *   <li>{@code clutchAttempts} and {@code clutchWins} count the clutches of {@link RoundTimeline#clutch} the player
 *       was in and the ones his side won.
 * </ul>
 *
 * <p>Every player of the match gets all of the values; none of them is {@code null} for a player who played a round.
 */
@Component
public class StatsCalculator {

    /** The health every player starts a round with. */
    private static final int ROUND_START_HEALTH = 100;

    private static final int ADR_SCALE = 2;

    private static final int PERCENT = 100;

    private static final int KAST_SCALE = 2;

    private final AnalysisProperties properties;

    public StatsCalculator(AnalysisProperties properties) {
        this.properties = properties;
    }

    /**
     * @return the values of every player who played a round, by player id (ascending)
     */
    public Map<Long, PlayerMatchStatsValues> calculate(MatchFacts facts) {
        long tradeWindow = (long) properties.tradeWindowSeconds() * facts.tickRate();
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
            countEntriesTradesAndKast(round, tradeWindow, tallies);
            countClutches(round, tallies);
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

    /**
     * The entry kill, the trade kills and the rounds that count for KAST in one round. The kills are taken in the
     * order they happened, which is how {@link RoundFacts} hands them over. Only roster players can be counted, since
     * a kill or an assist counts only between two players who played the round.
     */
    private static void countEntriesTradesAndKast(RoundFacts round, long tradeWindow, Map<Long, Tally> tallies) {
        Set<Long> contributed = new HashSet<>(); // had a kill, an assist or a traded death in the round (K, A, T)
        Set<Long> died = new HashSet<>(); // is the victim of any row of the round, whoever caused it (not S)
        boolean opened = false;
        for (KillFact kill : round.kills()) {
            died.add(kill.victimId());
            // An assist counts when the assister is an enemy of the victim, as in countKills, whoever killed him.
            if (round.enemies(kill.assisterId(), kill.victimId())) {
                contributed.add(kill.assisterId());
            }
            if (!isEnemyKill(round, kill)) {
                continue;
            }
            Tally killer = tallies.get(kill.killerId());
            contributed.add(kill.killerId());
            if (!opened) {
                killer.entryKills++;
                opened = true;
            }
            Set<Long> traded = tradedBy(round, kill, tradeWindow);
            if (!traded.isEmpty()) {
                killer.tradeKills++;
                contributed.addAll(traded);
            }
        }
        for (Long player : round.sides().keySet()) {
            if (contributed.contains(player) || !died.contains(player)) {
                tallies.get(player).kastRounds++;
            }
        }
    }

    /**
     * The teammates of the killer whose death {@code kill}, a kill of an enemy, trades: the players the victim of
     * {@code kill} killed at most {@code window} ticks before it, or on its tick. The killer himself is not one of
     * them (nobody trades his own death), nor is anybody who played the other side. The row of {@code kill} itself is
     * never one of the earlier kills: its killer is not its victim.
     */
    private static Set<Long> tradedBy(RoundFacts round, KillFact kill, long window) {
        long killer = kill.killerId();
        Side killerSide = round.sides().get(killer);
        Set<Long> traded = new TreeSet<>();
        for (KillFact earlier : round.kills()) {
            long ago = (long) kill.tick() - earlier.tick();
            if (earlier.killerId() != null && earlier.killerId().longValue() == kill.victimId()
                    && earlier.victimId() != killer && round.sides().get(earlier.victimId()) == killerSide
                    && ago >= 0 && ago <= window) {
                traded.add(earlier.victimId());
            }
        }
        return traded;
    }

    private static void countClutches(RoundFacts round, Map<Long, Tally> tallies) {
        RoundTimeline timeline = RoundTimeline.of(round);
        for (Side side : Side.values()) {
            timeline.clutch(side).ifPresent(attempt -> {
                Tally player = tallies.get(attempt.playerId());
                player.clutchAttempts++;
                if (attempt.won()) {
                    player.clutchWins++;
                }
            });
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
        int entryKills;
        int tradeKills;
        /** The rounds with a kill, an assist, a survival or a traded death. */
        int kastRounds;
        int clutchAttempts;
        int clutchWins;

        PlayerMatchStatsValues toValues(Boolean won) {
            BigDecimal adr = roundsPlayed == 0 ? null
                    : BigDecimal.valueOf(damage).divide(BigDecimal.valueOf(roundsPlayed), ADR_SCALE,
                            RoundingMode.HALF_UP);
            BigDecimal kast = roundsPlayed == 0 ? null
                    : BigDecimal.valueOf((long) PERCENT * kastRounds).divide(BigDecimal.valueOf(roundsPlayed),
                            KAST_SCALE, RoundingMode.HALF_UP);
            return new PlayerMatchStatsValues(kills, deaths, assists, headshots, adr, roundsPlayed, won, kast,
                    entryKills, tradeKills, clutchAttempts, clutchWins);
        }
    }
}
