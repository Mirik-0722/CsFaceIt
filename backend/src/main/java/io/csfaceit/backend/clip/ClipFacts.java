package io.csfaceit.backend.clip;

import io.csfaceit.backend.analysis.AnalysisPersistence;
import io.csfaceit.backend.demo.Demo;
import io.csfaceit.backend.demo.DemoStatus;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * The facts of a demo that a clip is cut by: the kills of one player, and the tick rate the demo is read at. It only
 * reads the parser's tables, and every answer is in the order of the demo, by tick.
 *
 * <p>A kill here is a kill of an enemy, the same rule as in the segments of a clip: the player is the killer, did not
 * kill himself, and killer and victim were not on the same side ({@code killer_side} differs from
 * {@code victim_side}, a missing side counts as a side of its own). A team kill, a kill of oneself and a death by the
 * world or the bomb are none.
 */
@Component
public class ClipFacts {

    /**
     * One round of a match with the ticks of the player's kills in it; {@code startTick..endTick} is the round. The
     * list of ticks is copied when the record is made, so it cannot be changed through the record.
     */
    public record RoundKills(int roundNumber, int startTick, int endTick, List<Integer> ticks) {

        public RoundKills {
            ticks = List.copyOf(ticks);
        }
    }

    /** One kill of the player, as a clip page lists it; {@code weapon} is the raw name from the demo. */
    public record KillRow(int tick, String weapon, boolean headshot, String victimNickname) {
    }

    /**
     * One kill of the player as the montage editor lists it, with its round: {@code roundStartTick..roundEndTick} is
     * the round, and {@code side} the side the player played it on as the roster of the round says, or as the kill
     * itself says when the roster does not list him ({@code null} when neither does).
     */
    public record EditorKillRow(int roundNumber, int roundStartTick, int roundEndTick, String side, int tick,
                                String weapon, boolean headshot, boolean wallbang, boolean noscope,
                                boolean throughSmoke, String victimNickname) {
    }

    /** One round of a match: {@code startTick..endTick}, both included. */
    public record RoundSpan(int roundNumber, int startTick, int endTick) {
    }

    private static final String ENEMY_KILL = """
            k.match_id = :matchId AND k.killer_id = :playerId AND k.victim_id <> k.killer_id
              AND k.killer_side IS DISTINCT FROM k.victim_side""";

    private static final String KILL_TICKS_SQL = """
            SELECT k.tick
            FROM kills k
            WHERE %s AND k.round_number = :roundNumber AND k.tick BETWEEN :fromTick AND :toTick
            ORDER BY k.tick, k.id""".formatted(ENEMY_KILL);

    private static final String KILL_TICKS_BY_ROUND_SQL = """
            SELECT k.round_number, r.start_tick, r.end_tick, k.tick
            FROM kills k
            JOIN rounds r ON r.match_id = k.match_id AND r.round_number = k.round_number
            WHERE %s
            ORDER BY k.round_number, k.tick, k.id""".formatted(ENEMY_KILL);

    private static final String KILLS_IN_SQL = """
            SELECT k.tick, k.weapon, k.headshot, v.nickname AS victim_nickname
            FROM kills k
            JOIN players v ON v.id = k.victim_id
            WHERE %s AND k.tick BETWEEN :fromTick AND :toTick
            ORDER BY k.tick, k.id""".formatted(ENEMY_KILL);

    private static final String EDITOR_KILLS_SQL = """
            SELECT k.round_number, r.start_tick, r.end_tick, COALESCE(rp.side, k.killer_side) AS side, k.tick,
                   k.weapon, k.headshot, k.wallbang, k.noscope, k.thrusmoke, v.nickname AS victim_nickname
            FROM kills k
            JOIN rounds r ON r.match_id = k.match_id AND r.round_number = k.round_number
            JOIN players v ON v.id = k.victim_id
            LEFT JOIN round_players rp ON rp.match_id = k.match_id AND rp.round_number = k.round_number
                                      AND rp.player_id = k.killer_id
            WHERE %s
            ORDER BY k.round_number, k.tick, k.id""".formatted(ENEMY_KILL);

    private static final String ROUNDS_SQL = """
            SELECT r.round_number, r.start_tick, r.end_tick
            FROM rounds r
            WHERE r.match_id = :matchId
            ORDER BY r.round_number""";

    /**
     * Whether the player is one of the match: the demo's roster of a round lists him, a kill names him, or FACEIT's
     * statistics of the match have a row of his.
     */
    private static final String PLAYS_IN_SQL = """
            SELECT EXISTS (SELECT 1 FROM round_players WHERE match_id = :matchId AND player_id = :playerId)
                OR EXISTS (SELECT 1 FROM kills WHERE match_id = :matchId
                           AND (killer_id = :playerId OR victim_id = :playerId))
                OR EXISTS (SELECT 1 FROM player_match_stats WHERE match_id = :matchId AND player_id = :playerId)""";

    private final JdbcClient jdbc;

    public ClipFacts(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The ticks per second to read a demo at: its own, or the default one when the parser could not tell
     * ({@code demos.tick_rate} is null or not positive). Seconds become ticks, and ticks become time, with this.
     */
    public static int tickRate(Integer demoTickRate) {
        return demoTickRate != null && demoTickRate > 0 ? demoTickRate : AnalysisPersistence.DEFAULT_TICK_RATE;
    }

    /**
     * Whether a recorder can be given the file of the demo: the file is stored (the retention job clears the key of a
     * demo whose file it removed) and the demo has been parsed, so that the player and the ticks are known.
     */
    public static boolean hasStoredFile(Demo demo) {
        return demo.getStorageKey() != null
                && (demo.getStatus() == DemoStatus.PARSED || demo.getStatus() == DemoStatus.ANALYZED);
    }

    /**
     * The ticks of the player's kills of an enemy in one round, from {@code fromTick} to {@code toTick}, both
     * included. The ticks of two kills on the same tick are both there.
     */
    public List<Integer> killTicks(long matchId, long playerId, int roundNumber, int fromTick, int toTick) {
        return jdbc.sql(KILL_TICKS_SQL)
                .param("matchId", matchId)
                .param("playerId", playerId)
                .param("roundNumber", roundNumber)
                .param("fromTick", fromTick)
                .param("toTick", toTick)
                .query(Integer.class)
                .list();
    }

    /**
     * The player's kills of an enemy in every round of the match that has one, by round number, each round with its
     * own first and last tick. A round in which he made no such kill is not in the answer.
     */
    public List<RoundKills> killTicksByRound(long matchId, long playerId) {
        List<RoundTick> rows = jdbc.sql(KILL_TICKS_BY_ROUND_SQL)
                .param("matchId", matchId)
                .param("playerId", playerId)
                .query((rs, rowNumber) -> new RoundTick(rs.getInt("round_number"), rs.getInt("start_tick"),
                        rs.getInt("end_tick"), rs.getInt("tick")))
                .list();
        return rows.stream()
                .collect(Collectors.groupingBy(RoundTick::roundNumber, LinkedHashMap::new, Collectors.toList()))
                .values().stream()
                .map(round -> new RoundKills(round.get(0).roundNumber(), round.get(0).startTick(),
                        round.get(0).endTick(), round.stream().map(RoundTick::tick).toList()))
                .toList();
    }

    /**
     * The player's kills of an enemy from {@code fromTick} to {@code toTick}, both included, with the weapon, whether
     * it was a headshot and the nickname of the victim. The ticks of a demo only grow, so no round is named.
     */
    public List<KillRow> killsIn(long matchId, long playerId, int fromTick, int toTick) {
        return jdbc.sql(KILLS_IN_SQL)
                .param("matchId", matchId)
                .param("playerId", playerId)
                .param("fromTick", fromTick)
                .param("toTick", toTick)
                .query((rs, rowNumber) -> new KillRow(rs.getInt("tick"), rs.getString("weapon"),
                        rs.getBoolean("headshot"), rs.getString("victim_nickname")))
                .list();
    }

    /**
     * Every kill of an enemy the player made in the match, with what the montage editor shows of it and the round it
     * falls in, by round number and then by tick. A kill in a round the parser has no row of is not in the answer.
     */
    public List<EditorKillRow> editorKills(long matchId, long playerId) {
        return jdbc.sql(EDITOR_KILLS_SQL)
                .param("matchId", matchId)
                .param("playerId", playerId)
                .query((rs, rowNumber) -> new EditorKillRow(rs.getInt("round_number"), rs.getInt("start_tick"),
                        rs.getInt("end_tick"), rs.getString("side"), rs.getInt("tick"), rs.getString("weapon"),
                        rs.getBoolean("headshot"), rs.getBoolean("wallbang"), rs.getBoolean("noscope"),
                        rs.getBoolean("thrusmoke"), rs.getString("victim_nickname")))
                .list();
    }

    /** The rounds of the match the parser found, by number; empty for a demo that is not parsed. */
    public List<RoundSpan> rounds(long matchId) {
        return jdbc.sql(ROUNDS_SQL)
                .param("matchId", matchId)
                .query((rs, rowNumber) -> new RoundSpan(rs.getInt("round_number"), rs.getInt("start_tick"),
                        rs.getInt("end_tick")))
                .list();
    }

    /** Whether the player played in the match, as the facts of its demo or FACEIT's statistics of it say. */
    public boolean playsIn(long matchId, long playerId) {
        return Boolean.TRUE.equals(jdbc.sql(PLAYS_IN_SQL)
                .param("matchId", matchId)
                .param("playerId", playerId)
                .query(Boolean.class)
                .single());
    }

    /** A kill with the round it falls in, as the join of {@code killTicksByRound} reads it. */
    private record RoundTick(int roundNumber, int startTick, int endTick, int tick) {
    }
}
