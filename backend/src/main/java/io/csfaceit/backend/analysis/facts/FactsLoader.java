package io.csfaceit.backend.analysis.facts;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reads the facts the demo parser wrote for one match ({@code rounds}, {@code round_players}, {@code kills} and
 * {@code damages}) into a {@link MatchFacts}. It only reads: the tables belong to the parser.
 *
 * <p>Each table is one query, ordered by round and, where there is a tick, by {@code (tick, id)}. Rows that belong
 * to a round number {@code rounds} has no row for are dropped. A side the database holds that is not {@code CT} or
 * {@code T} counts as no side. The roster of a round starts as its {@code round_players} rows; a player the kill
 * events of the round name with a side and the roster lacks is added (a parse that has no roster rows, or a player
 * who died before the first sampled position), and where the two disagree the roster wins.
 *
 * <p>The four queries run in one read-only transaction at the repeatable-read level, so they see one snapshot: a new
 * parse that commits between them cannot mix two parses into one {@link MatchFacts}. (The analysis would drop such a
 * result anyway, see {@code AnalysisPersistence#store}; this keeps it from ever computing with one.)
 */
@Component
public class FactsLoader {

    private static final String ROUNDS_SQL = """
            SELECT round_number, winner_side, start_tick, end_tick, decided_tick, bomb_planted_tick,
                   bomb_defused_tick, defuser_id
            FROM rounds
            WHERE match_id = :matchId
            ORDER BY round_number""";

    private static final String ROSTER_SQL = """
            SELECT round_number, player_id, side
            FROM round_players
            WHERE match_id = :matchId
            ORDER BY round_number, player_id""";

    private static final String KILLS_SQL = """
            SELECT round_number, tick, killer_id, victim_id, assister_id, weapon, headshot, wallbang, noscope,
                   thrusmoke, killer_side, victim_side
            FROM kills
            WHERE match_id = :matchId
            ORDER BY round_number, tick, id""";

    private static final String DAMAGES_SQL = """
            SELECT round_number, tick, attacker_id, victim_id, damage_health
            FROM damages
            WHERE match_id = :matchId
            ORDER BY round_number, tick, id""";

    private final JdbcClient jdbc;

    public FactsLoader(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @param matchRowId {@code matches.id}
     * @param tickRate the ticks per second of the demo, which the caller knows from {@code demos.tick_rate}
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public MatchFacts load(long matchRowId, int tickRate) {
        List<RoundRow> roundRows = jdbc.sql(ROUNDS_SQL).param("matchId", matchRowId)
                .query(FactsLoader::roundRow).list();
        Map<Integer, Map<Long, Side>> rosters = new TreeMap<>();
        for (RosterRow row : jdbc.sql(ROSTER_SQL).param("matchId", matchRowId)
                .query(FactsLoader::rosterRow).list()) {
            if (row.side() != null) {
                rosters.computeIfAbsent(row.roundNumber(), round -> new TreeMap<>()).put(row.playerId(), row.side());
            }
        }
        Map<Integer, List<KillFact>> kills = jdbc.sql(KILLS_SQL).param("matchId", matchRowId)
                .query(FactsLoader::killRow).list().stream()
                .collect(Collectors.groupingBy(KillRow::roundNumber, Collectors.mapping(KillRow::fact,
                        Collectors.toList())));
        Map<Integer, List<DamageFact>> damages = jdbc.sql(DAMAGES_SQL).param("matchId", matchRowId)
                .query(FactsLoader::damageRow).list().stream()
                .collect(Collectors.groupingBy(DamageRow::roundNumber, Collectors.mapping(DamageRow::fact,
                        Collectors.toList())));

        List<RoundFacts> rounds = new ArrayList<>(roundRows.size());
        for (RoundRow row : roundRows) {
            List<KillFact> roundKills = kills.getOrDefault(row.roundNumber(), List.of());
            rounds.add(new RoundFacts(row.roundNumber(), row.winnerSide(), row.startTick(), row.endTick(),
                    row.decidedTick() != null ? row.decidedTick() : row.endTick(), row.bombPlantedTick(),
                    row.bombDefusedTick(), row.defuserId(),
                    roster(rosters.getOrDefault(row.roundNumber(), Map.of()), roundKills), roundKills,
                    damages.getOrDefault(row.roundNumber(), List.of())));
        }
        return new MatchFacts(matchRowId, tickRate, rounds);
    }

    /** The roster rows of the round, plus the players of its kill events that they do not list, with their sides. */
    private static Map<Long, Side> roster(Map<Long, Side> listed, List<KillFact> kills) {
        Map<Long, Side> sides = new TreeMap<>(listed);
        for (KillFact kill : kills) {
            if (kill.killerId() != null && kill.killerSide() != null) {
                sides.putIfAbsent(kill.killerId(), kill.killerSide());
            }
            if (kill.victimSide() != null) {
                sides.putIfAbsent(kill.victimId(), kill.victimSide());
            }
        }
        return sides;
    }

    private record RoundRow(int roundNumber, Side winnerSide, int startTick, int endTick, Integer decidedTick,
                            Integer bombPlantedTick, Integer bombDefusedTick, Long defuserId) {
    }

    private record RosterRow(int roundNumber, long playerId, Side side) {
    }

    private record KillRow(int roundNumber, KillFact fact) {
    }

    private record DamageRow(int roundNumber, DamageFact fact) {
    }

    private static RoundRow roundRow(ResultSet rs, int row) throws SQLException {
        return new RoundRow(rs.getInt("round_number"), Side.fromDatabase(rs.getString("winner_side")),
                rs.getInt("start_tick"), rs.getInt("end_tick"), nullableInt(rs, "decided_tick"),
                nullableInt(rs, "bomb_planted_tick"), nullableInt(rs, "bomb_defused_tick"),
                nullableLong(rs, "defuser_id"));
    }

    private static RosterRow rosterRow(ResultSet rs, int row) throws SQLException {
        return new RosterRow(rs.getInt("round_number"), rs.getLong("player_id"),
                Side.fromDatabase(rs.getString("side")));
    }

    private static KillRow killRow(ResultSet rs, int row) throws SQLException {
        return new KillRow(rs.getInt("round_number"), new KillFact(rs.getInt("tick"), nullableLong(rs, "killer_id"),
                rs.getLong("victim_id"), nullableLong(rs, "assister_id"), rs.getString("weapon"),
                rs.getBoolean("headshot"), rs.getBoolean("wallbang"), rs.getBoolean("noscope"),
                rs.getBoolean("thrusmoke"), Side.fromDatabase(rs.getString("killer_side")),
                Side.fromDatabase(rs.getString("victim_side"))));
    }

    private static DamageRow damageRow(ResultSet rs, int row) throws SQLException {
        return new DamageRow(rs.getInt("round_number"), new DamageFact(rs.getInt("tick"),
                nullableLong(rs, "attacker_id"), rs.getLong("victim_id"), rs.getInt("damage_health")));
    }

    private static Integer nullableInt(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, Integer.class);
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, Long.class);
    }
}
