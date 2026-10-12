package io.csfaceit.backend.player;

import io.csfaceit.backend.clip.ClipStatus;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.player.dto.ClipCounts;
import io.csfaceit.backend.player.dto.HighlightCount;
import io.csfaceit.backend.player.dto.MapResult;
import io.csfaceit.backend.player.dto.MatchHistoryResponse;
import io.csfaceit.backend.player.dto.MatchSummary;
import io.csfaceit.backend.player.dto.PlayerMatchListResponse;
import io.csfaceit.backend.player.dto.PlayerMatchResponse;
import io.csfaceit.backend.player.dto.PlayerOverviewResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The two reads behind the player page and the list of matches: the player's results by map and his highlights by
 * type, and what the backend knows of each match of a page of his FACEIT history. Only the database is read here;
 * the history itself comes from {@link PlayerService#getHistory}, which the caller runs first and with no transaction
 * open, so that a connection is never held while FACEIT is waited for.
 *
 * <ul>
 *   <li>The results by map are over the same matches the aggregate statistics count: every {@code player_match_stats}
 *       row of the player, FACEIT's numbers included, except that a match with no map name has no map to be counted
 *       under. {@code wins} are the rows whose {@code won} is true. {@code kd} is worked out from the sums of kills and
 *       deaths, in exact decimal arithmetic and rounded once. {@code adr} is the mean of the stored ADR of the
 *       analyzed rows ({@code rounds_played} is set) only, as the aggregate takes the mean of the matches, not
 *       weighted by the rounds: the ADR of the other rows is FACEIT's and is not used, so a map with no analyzed
 *       match has none.
 *   <li>Highlights are counted under the rule the highlight endpoints serve them by: only while the demo of their match
 *       is {@code ANALYZED}. After a demo was uploaded again the earlier analysis' rows are still in the table but
 *       belong to a file that is no longer the stored one, and the figures here are meant to agree with the lists.
 *   <li>A page of matches costs three statements whatever its size, each for the whole page ({@code IN} over the
 *       match ids): the numbers of the player with the map and the demo, his highlights by type, and his clips by
 *       status. They run in one read-only transaction on one snapshot, so a demo that is analyzed again in between
 *       cannot show a status that belongs to other highlights than the ones counted.
 * </ul>
 *
 * <p>A player or a match the database does not know is not an error: the lists are empty and the figures {@code null}.
 */
@Service
public class PlayerOverviewService {

    private static final int RATIO_SCALE = 2;
    private static final int ADR_SCALE = 1;

    /**
     * One row for each map. The player is found by his FACEIT id ({@code steam:<SteamID>} for one known only from a
     * demo), as in {@code StatsQueryService}. {@code count(*)} is the matches because a player has at most one row for
     * a match ({@code UNIQUE (player_id, match_id)}). {@code avg} ignores the null ADR of a row whose player played no
     * round, and gives null when no row qualifies.
     */
    private static final String MAPS_SQL = """
            SELECT m.map_name,
                   count(*) AS matches,
                   count(*) FILTER (WHERE s.won) AS wins,
                   coalesce(sum(s.kills), 0) AS kills,
                   coalesce(sum(s.deaths), 0) AS deaths,
                   avg(s.adr) FILTER (WHERE s.rounds_played IS NOT NULL) AS adr
            FROM player_match_stats s
            JOIN players p ON p.id = s.player_id
            JOIN matches m ON m.id = s.match_id
            WHERE p.faceit_id = :playerId AND m.map_name IS NOT NULL
            GROUP BY m.map_name
            ORDER BY count(*) DESC, m.map_name""";

    private static final String HIGHLIGHT_TYPES_SQL = """
            SELECT h.type, count(*) AS highlights
            FROM highlights h
            JOIN players p ON p.id = h.player_id
            JOIN demos d ON d.match_id = h.match_id
            WHERE p.faceit_id = :playerId AND d.status = :analyzed
            GROUP BY h.type
            ORDER BY count(*) DESC, h.type""";

    /**
     * The stored matches of the page, one row each, with the player's row of statistics and the demo when there are
     * any (both are left joins: a match can have neither). The player is looked up once, in a sub-select; when the
     * database does not know him it yields null and no row of statistics matches. The ADR counts only for a row
     * analyzed from a demo, because the ADR of the others is FACEIT's.
     */
    private static final String MATCH_FACTS_SQL = """
            SELECT m.faceit_match_id, m.map_name, s.kills, s.deaths, s.assists,
                   CASE WHEN s.rounds_played IS NOT NULL THEN s.adr END AS adr,
                   d.status AS demo_status
            FROM matches m
            LEFT JOIN player_match_stats s ON s.match_id = m.id
                                          AND s.player_id = (SELECT id FROM players WHERE faceit_id = :playerId)
            LEFT JOIN demos d ON d.match_id = m.id
            WHERE m.faceit_match_id IN (:matchIds)""";

    private static final String MATCH_HIGHLIGHTS_SQL = """
            SELECT m.faceit_match_id, h.type, count(*) AS highlights
            FROM highlights h
            JOIN players p ON p.id = h.player_id
            JOIN matches m ON m.id = h.match_id
            JOIN demos d ON d.match_id = h.match_id
            WHERE p.faceit_id = :playerId AND d.status = :analyzed AND m.faceit_match_id IN (:matchIds)
            GROUP BY m.faceit_match_id, h.type
            ORDER BY m.faceit_match_id, count(*) DESC, h.type""";

    /**
     * The clips that follow the player ({@code clips.player_id}: his compilation of the match and the clips of his
     * highlights), by the three groups the response names. A clip is waiting or being worked on while it is in none
     * of the two final statuses; a status this version does not know is in no group.
     */
    private static final String MATCH_CLIPS_SQL = """
            SELECT m.faceit_match_id,
                   count(*) FILTER (WHERE c.status = :done) AS done,
                   count(*) FILTER (WHERE c.status IN (:active)) AS active,
                   count(*) FILTER (WHERE c.status = :failed) AS failed
            FROM clips c
            JOIN matches m ON m.id = c.match_id
            WHERE c.player_id = (SELECT id FROM players WHERE faceit_id = :playerId)
              AND m.faceit_match_id IN (:matchIds)
            GROUP BY m.faceit_match_id""";

    /** Not {@link ClipStatus#isActive()}: that one leaves out the clips still waiting in the queue. */
    private static final List<String> ACTIVE_CLIP_STATUSES = Arrays.stream(ClipStatus.values())
            .filter(status -> status != ClipStatus.DONE && status != ClipStatus.FAILED)
            .map(ClipStatus::name)
            .toList();

    private static final ClipCounts NO_CLIPS = new ClipCounts(0, 0, 0);

    private final JdbcClient jdbc;

    public PlayerOverviewService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The player's results by map and his highlights by type, from two statements on one snapshot.
     *
     * @param faceitPlayerId the FACEIT player id ({@code players.faceit_id}); {@code steam:<SteamID>} for a player
     *                       known only from a demo
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PlayerOverviewResponse overview(String faceitPlayerId) {
        List<MapResult> maps = jdbc.sql(MAPS_SQL)
                .param("playerId", faceitPlayerId)
                .query((rs, rowNumber) -> new MapResult(rs.getString("map_name"), rs.getInt("matches"),
                        rs.getInt("wins"), kd(rs.getLong("kills"), rs.getLong("deaths")),
                        adr(rs.getBigDecimal("adr"))))
                .list();
        List<HighlightCount> highlights = jdbc.sql(HIGHLIGHT_TYPES_SQL)
                .param("playerId", faceitPlayerId)
                .param("analyzed", DemoStatus.ANALYZED.name())
                .query((rs, rowNumber) -> new HighlightCount(rs.getString("type"), rs.getInt("highlights")))
                .list();
        return new PlayerOverviewResponse(faceitPlayerId, maps, highlights);
    }

    /**
     * The page of the player's history with what the database knows of each of its matches, in the order of the page.
     * A page with no match reads nothing.
     *
     * @param faceitPlayerId the FACEIT player id the history was asked for
     * @param history the page {@link PlayerService#getHistory} returned for him
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PlayerMatchListResponse matches(String faceitPlayerId, MatchHistoryResponse history) {
        List<MatchSummary> page = history.items();
        if (page.isEmpty()) {
            return new PlayerMatchListResponse(List.of(), history.offset(), history.limit());
        }
        List<String> matchIds = page.stream().map(MatchSummary::matchId).toList();
        Map<String, StoredMatch> stored = storedMatches(faceitPlayerId, matchIds);
        Map<String, List<HighlightCount>> highlights = highlightsByMatch(faceitPlayerId, matchIds);
        Map<String, ClipCounts> clips = clipsByMatch(faceitPlayerId, matchIds);
        List<PlayerMatchResponse> items = page.stream()
                .map(line -> {
                    String id = line.matchId();
                    return response(line, stored.get(id), highlights.getOrDefault(id, List.of()),
                            clips.getOrDefault(id, NO_CLIPS));
                })
                .toList();
        return new PlayerMatchListResponse(items, history.offset(), history.limit());
    }

    private Map<String, StoredMatch> storedMatches(String faceitPlayerId, List<String> matchIds) {
        Map<String, StoredMatch> stored = new HashMap<>();
        jdbc.sql(MATCH_FACTS_SQL)
                .param("playerId", faceitPlayerId)
                .param("matchIds", matchIds)
                .query(rs -> {
                    stored.put(rs.getString("faceit_match_id"), new StoredMatch(rs.getString("map_name"),
                            rs.getObject("kills", Integer.class), rs.getObject("deaths", Integer.class),
                            rs.getObject("assists", Integer.class), adr(rs.getBigDecimal("adr")),
                            rs.getString("demo_status")));
                });
        return stored;
    }

    /** The rows come ordered by match, most frequent type first, and each match's list keeps that order. */
    private Map<String, List<HighlightCount>> highlightsByMatch(String faceitPlayerId, List<String> matchIds) {
        Map<String, List<HighlightCount>> byMatch = new HashMap<>();
        jdbc.sql(MATCH_HIGHLIGHTS_SQL)
                .param("playerId", faceitPlayerId)
                .param("analyzed", DemoStatus.ANALYZED.name())
                .param("matchIds", matchIds)
                .query(rs -> {
                    byMatch.computeIfAbsent(rs.getString("faceit_match_id"), id -> new ArrayList<>())
                            .add(new HighlightCount(rs.getString("type"), rs.getInt("highlights")));
                });
        return byMatch;
    }

    private Map<String, ClipCounts> clipsByMatch(String faceitPlayerId, List<String> matchIds) {
        Map<String, ClipCounts> byMatch = new HashMap<>();
        jdbc.sql(MATCH_CLIPS_SQL)
                .param("playerId", faceitPlayerId)
                .param("done", ClipStatus.DONE.name())
                .param("active", ACTIVE_CLIP_STATUSES)
                .param("failed", ClipStatus.FAILED.name())
                .param("matchIds", matchIds)
                .query(rs -> {
                    byMatch.put(rs.getString("faceit_match_id"),
                            new ClipCounts(rs.getInt("done"), rs.getInt("active"), rs.getInt("failed")));
                });
        return byMatch;
    }

    private static PlayerMatchResponse response(MatchSummary line, StoredMatch stored, List<HighlightCount> highlights,
                                                ClipCounts clips) {
        // A match the database does not have is a line of the history and nothing else.
        StoredMatch known = stored != null ? stored : StoredMatch.NONE;
        return new PlayerMatchResponse(line.matchId(), known.mapName(), line.startedAt(), line.finishedAt(),
                line.result(), line.score(), known.kills(), known.deaths(), known.assists(), known.adr(),
                known.demoStatus(), highlights, clips);
    }

    /** Kills over deaths with two decimals, worked out from the sums and rounded once; over 1 when nobody died. */
    private static double kd(long kills, long deaths) {
        return BigDecimal.valueOf(kills)
                .divide(BigDecimal.valueOf(Math.max(deaths, 1)), RATIO_SCALE, RoundingMode.HALF_UP)
                .doubleValue();
    }

    private static Double adr(BigDecimal adr) {
        return adr == null ? null : adr.setScale(ADR_SCALE, RoundingMode.HALF_UP).doubleValue();
    }

    /** What the first statement of a page reads of one stored match; the numbers are null without a row of his. */
    private record StoredMatch(String mapName, Integer kills, Integer deaths, Integer assists, Double adr,
                               String demoStatus) {

        static final StoredMatch NONE = new StoredMatch(null, null, null, null, null, null);
    }
}
