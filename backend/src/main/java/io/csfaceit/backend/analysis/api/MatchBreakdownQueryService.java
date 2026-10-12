package io.csfaceit.backend.analysis.api;

import io.csfaceit.backend.analysis.api.dto.BreakdownPlayer;
import io.csfaceit.backend.analysis.api.dto.BreakdownRound;
import io.csfaceit.backend.analysis.api.dto.MatchBreakdownResponse;
import io.csfaceit.backend.analysis.facts.Side;
import io.csfaceit.backend.demo.DemoStatus;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reads the breakdown of a match for its page: who won each round, and the numbers the analysis computed for each
 * player. It only reads the database: nothing here talks to FACEIT.
 *
 * <p>Like the highlights, the breakdown is served only while the demo of the match is {@code ANALYZED}. Once the demo
 * was uploaded again (it is {@code STORED}, then {@code PARSED}) the new parse has replaced the rounds, while the
 * figures of the players are still those of the earlier analysis until a new one has run; a demo that was parsed again
 * and failed leaves both from a file that is no longer the stored one. Either way the answer would not describe one
 * demo. A match whose demo is in any other status, that has no demo, or that the database does not know has two empty
 * lists.
 *
 * <p>The breakdown is two statements, whatever the number of rounds and players: one for the rounds with the ids of the
 * players who won each, and one for the players. Both carry the same gate and run in one read-only transaction on one
 * snapshot, so a parse or an analysis that commits in between cannot leave the rounds of one demo beside the players
 * of another.
 */
@Service
public class MatchBreakdownQueryService {

    /** The scale {@code StatsQueryService} reports a KAST at: a percentage with one decimal. */
    private static final int KAST_SCALE = 1;

    /**
     * The rounds of an analyzed demo, by number, each with the ids of the players who played it on the winning side
     * ({@code round_players}), ascending. The ids are sorted bytewise ({@code COLLATE "C"}) so that the order does not
     * depend on the collation the database was created with. {@code ARRAY(...)} gives an empty array, not null, for a
     * round nobody won: with no winner the side comparison matches no roster row. A {@code winner_side} that is neither
     * {@code CT} nor {@code T} is no winner either, as everywhere in the analysis ({@link Side#fromDatabase}).
     */
    private static final String ROUNDS_SQL = """
            SELECT r.round_number, r.winner_side,
                   ARRAY(SELECT p.faceit_id
                         FROM round_players rp
                         JOIN players p ON p.id = rp.player_id
                         WHERE rp.match_id = r.match_id AND rp.round_number = r.round_number
                           AND r.winner_side IN ('CT', 'T') AND rp.side = r.winner_side
                         ORDER BY p.faceit_id COLLATE "C" ASC) AS winner_player_ids
            FROM matches m
            JOIN demos d ON d.match_id = m.id
            JOIN rounds r ON r.match_id = m.id
            WHERE m.faceit_match_id = :matchId AND d.status = :analyzed
            ORDER BY r.round_number""";

    /**
     * The players of an analyzed demo, by id: the rows of {@code player_match_stats} that come from the analysis of a
     * demo ({@code rounds_played} is set), the notion {@code StatsQueryService} uses. The rows that only hold FACEIT's
     * numbers have no KAST, entry, trade or clutch figure and are not part of the breakdown.
     */
    private static final String PLAYERS_SQL = """
            SELECT p.faceit_id AS player_id, s.kast, s.entry_kills, s.trade_kills, s.clutch_wins, s.clutch_attempts
            FROM matches m
            JOIN demos d ON d.match_id = m.id
            JOIN player_match_stats s ON s.match_id = m.id
            JOIN players p ON p.id = s.player_id
            WHERE m.faceit_match_id = :matchId AND d.status = :analyzed AND s.rounds_played IS NOT NULL
            ORDER BY p.faceit_id COLLATE "C" ASC""";

    private final JdbcClient jdbc;

    public MatchBreakdownQueryService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The breakdown of one match. Both lists are empty when the match is not in the database or its demo is not
     * {@code ANALYZED}.
     *
     * @param faceitMatchId the FACEIT match id ({@code matches.faceit_match_id}), echoed in the answer
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public MatchBreakdownResponse forMatch(String faceitMatchId) {
        Objects.requireNonNull(faceitMatchId, "faceitMatchId");
        List<BreakdownRound> rounds = statement(ROUNDS_SQL, faceitMatchId)
                .query(MatchBreakdownQueryService::round)
                .list();
        List<BreakdownPlayer> players = statement(PLAYERS_SQL, faceitMatchId)
                .query(MatchBreakdownQueryService::player)
                .list();
        return new MatchBreakdownResponse(faceitMatchId, rounds, players);
    }

    /** A statement with the two parameters both of them have: the match and the status its demo must be in. */
    private JdbcClient.StatementSpec statement(String sql, String faceitMatchId) {
        return jdbc.sql(sql).param("matchId", faceitMatchId).param("analyzed", DemoStatus.ANALYZED.name());
    }

    private static BreakdownRound round(ResultSet rs, int rowNumber) throws SQLException {
        Side winner = Side.fromDatabase(rs.getString("winner_side"));
        String[] winnerIds = (String[]) rs.getArray("winner_player_ids").getArray();
        return new BreakdownRound(rs.getInt("round_number"), winner == null ? null : winner.name(),
                List.of(winnerIds));
    }

    /**
     * The KAST is stored as a percentage with two decimals. It is reported with one, rounded half up in exact decimal
     * arithmetic like the aggregate of {@code StatsQueryService}, which for the one match of a row is the same figure.
     * The four counts are boxed: an analysis writes all of them, but a figure that is not there stays {@code null}.
     */
    private static BreakdownPlayer player(ResultSet rs, int rowNumber) throws SQLException {
        BigDecimal kast = rs.getBigDecimal("kast");
        return new BreakdownPlayer(rs.getString("player_id"),
                kast == null ? null : kast.setScale(KAST_SCALE, RoundingMode.HALF_UP).doubleValue(),
                rs.getObject("entry_kills", Integer.class), rs.getObject("trade_kills", Integer.class),
                rs.getObject("clutch_wins", Integer.class), rs.getObject("clutch_attempts", Integer.class));
    }
}
