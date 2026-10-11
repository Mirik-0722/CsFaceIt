package io.csfaceit.backend.analysis.api;

import io.csfaceit.backend.analysis.AnalysisPersistence;
import io.csfaceit.backend.analysis.api.dto.HighlightKill;
import io.csfaceit.backend.analysis.api.dto.HighlightPageResponse;
import io.csfaceit.backend.analysis.api.dto.HighlightResponse;
import io.csfaceit.backend.analysis.facts.Side;
import io.csfaceit.backend.analysis.highlight.HighlightType;
import io.csfaceit.backend.demo.DemoStatus;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reads the highlights the analysis stored, for the REST API and for whatever else needs them (the Telegram bot). It
 * only reads the database: nothing here talks to FACEIT.
 *
 * <p>A highlight is served only while the demo of its match is {@code ANALYZED}. Highlights are replaced by an analysis
 * and by nothing else, so after the demo was uploaded again (it is {@code STORED}, then {@code PARSED}), or parsed
 * again and failed, the earlier set would still be in the table although the stored file is another one, and a clip is
 * cut from the stored file by the ticks of a highlight. A match whose demo is in any other status, or that has no demo,
 * has no highlights here.
 *
 * <p>Each list is read with two statements, whatever its length: one for the highlights with their match, player,
 * round and side, and one for the kills of all of them. Both run in one read-only transaction on one snapshot, so an
 * analysis that commits in between cannot leave a highlight without the kills it was found for. A highlight is read by
 * its id with the same two statements, so the rule above applies to it as well.
 *
 * <p>A row whose type this version does not know (the database was rolled back from a later version) is skipped, with
 * one WARN naming the type for each request that meets it; the rest of the list is served.
 */
@Service
public class HighlightQueryService {

    private static final Logger log = LoggerFactory.getLogger(HighlightQueryService.class);

    /**
     * The highlights of analyzed demos. {@code round_players} is a left join because a player can be missing from the
     * recorded roster of a round (his side is then null; a demo without any roster is not analyzed at all);
     * {@code rounds} is an inner join because the analysis stores a highlight only for a round it has the facts of.
     */
    private static final String HIGHLIGHTS_SQL = """
            SELECT h.id, h.type, p.faceit_id AS player_faceit_id, p.nickname, h.round_number, rp.side,
                   h.tick_start, h.tick_end, r.start_tick AS round_start_tick, r.end_tick AS round_end_tick,
                   d.tick_rate, m.faceit_match_id, m.map_name, m.started_at
            FROM highlights h
            JOIN matches m ON m.id = h.match_id
            JOIN demos d ON d.match_id = h.match_id
            JOIN players p ON p.id = h.player_id
            JOIN rounds r ON r.match_id = h.match_id AND r.round_number = h.round_number
            LEFT JOIN round_players rp ON rp.match_id = h.match_id AND rp.round_number = h.round_number
                                      AND rp.player_id = h.player_id
            WHERE d.status = :analyzed""";

    private static final String MATCH_ORDER = " ORDER BY h.round_number, h.tick_start, h.id";

    /** The id comes last so that a page boundary falls in the same place on every request. */
    private static final String PLAYER_ORDER_AND_PAGE = " ORDER BY m.started_at DESC NULLS LAST, m.id DESC,"
            + " h.round_number, h.tick_start, h.id LIMIT :limit OFFSET :offset";

    /**
     * The kills of the highlights, each highlight's own player's kills of an enemy inside {@code tick_start..tick_end}
     * (both ends included) of its round, in the order of {@code (tick, id)}. A kill of an enemy is the analysis' rule
     * ({@code RoundFacts#enemies}): the killer is the player, is not the victim, and killer and victim played the round
     * on different sides, so a team kill, a kill of oneself and a death by the world are not kills.
     *
     * <p>The sides are the roster of the round as {@code FactsLoader} builds it. {@code listed} is the
     * {@code round_players} rows; {@code mentions} are the sides the kill events of the round give their killer and
     * their victim, in the order the loader reads them (by tick and id, the killer of an event before its victim); and
     * {@code named} keeps the first mention of every player the roster does not list. Where the two disagree the
     * roster wins, and a player in neither is nobody's enemy, because the join finds no side for him.
     */
    private static final String KILLS_SQL = """
            WITH page AS (
                SELECT h.id, h.match_id, h.round_number, h.player_id, h.tick_start, h.tick_end
                FROM highlights h
                WHERE h.id IN (:ids)),
            page_rounds AS (
                SELECT DISTINCT match_id, round_number FROM page),
            listed AS (
                SELECT rp.match_id, rp.round_number, rp.player_id, rp.side
                FROM round_players rp
                JOIN page_rounds pr ON pr.match_id = rp.match_id AND pr.round_number = rp.round_number
                WHERE rp.side IN ('CT', 'T')),
            mentions AS (
                SELECT k.match_id, k.round_number, k.killer_id AS player_id, k.killer_side AS side, k.tick, k.id,
                       0 AS part
                FROM kills k
                JOIN page_rounds pr ON pr.match_id = k.match_id AND pr.round_number = k.round_number
                WHERE k.killer_id IS NOT NULL AND k.killer_side IN ('CT', 'T')
                UNION ALL
                SELECT k.match_id, k.round_number, k.victim_id, k.victim_side, k.tick, k.id, 1
                FROM kills k
                JOIN page_rounds pr ON pr.match_id = k.match_id AND pr.round_number = k.round_number
                WHERE k.victim_side IN ('CT', 'T')),
            named AS (
                SELECT DISTINCT ON (m.match_id, m.round_number, m.player_id)
                       m.match_id, m.round_number, m.player_id, m.side
                FROM mentions m
                WHERE NOT EXISTS (SELECT 1 FROM listed l
                                  WHERE l.match_id = m.match_id AND l.round_number = m.round_number
                                    AND l.player_id = m.player_id)
                ORDER BY m.match_id, m.round_number, m.player_id, m.tick, m.id, m.part),
            roster AS (
                SELECT match_id, round_number, player_id, side FROM listed
                UNION ALL
                SELECT match_id, round_number, player_id, side FROM named)
            SELECT page.id AS highlight_id, k.tick, k.weapon, k.headshot, v.nickname AS victim_nickname
            FROM page
            JOIN kills k ON k.match_id = page.match_id AND k.round_number = page.round_number
                        AND k.killer_id = page.player_id AND k.victim_id <> k.killer_id
                        AND k.tick BETWEEN page.tick_start AND page.tick_end
            JOIN roster killer ON killer.match_id = k.match_id AND killer.round_number = k.round_number
                              AND killer.player_id = k.killer_id
            JOIN roster victim ON victim.match_id = k.match_id AND victim.round_number = k.round_number
                              AND victim.player_id = k.victim_id
            JOIN players v ON v.id = k.victim_id
            WHERE killer.side <> victim.side
            ORDER BY page.id, k.tick, k.id""";

    private final JdbcClient jdbc;

    public HighlightQueryService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The highlights of one match, by round, then by the first tick of the clip. Empty when the match is not in the
     * database, its demo is not {@code ANALYZED}, or nothing matches the filters.
     *
     * @param faceitMatchId the FACEIT match id ({@code matches.faceit_match_id})
     * @param type only this type of highlight, or {@code null} for every type
     * @param faceitPlayerId only the highlights of this player ({@code players.faceit_id}), or {@code null} for all
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<HighlightResponse> forMatch(String faceitMatchId, HighlightType type, String faceitPlayerId) {
        Objects.requireNonNull(faceitMatchId, "faceitMatchId");
        Map<String, Object> params = new HashMap<>();
        StringBuilder filter = new StringBuilder(" AND m.faceit_match_id = :matchId");
        params.put("matchId", faceitMatchId);
        filterByType(filter, params, type);
        if (faceitPlayerId != null) {
            filter.append(" AND p.faceit_id = :playerId");
            params.put("playerId", faceitPlayerId);
        }
        return withKills(select(filter + MATCH_ORDER, params));
    }

    /**
     * A page of the highlights of one player over all his matches, the newest match first (a match with no start time
     * last), and by round and clip within a match. Empty when the player is not in the database or none of his matches
     * has an {@code ANALYZED} demo.
     *
     * @param faceitPlayerId the FACEIT player id ({@code players.faceit_id}); {@code steam:<SteamID>} for a player
     *                       known only from a demo
     * @param type only this type of highlight, or {@code null} for every type
     * @param offset how many highlights to skip, 0 to 10000
     * @param limit the most highlights in the page, 1 to 100
     * @throws IllegalArgumentException {@code offset} or {@code limit} is negative; the REST controller keeps both in
     *         range, this guards the callers that are not the controller
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public HighlightPageResponse forPlayer(String faceitPlayerId, HighlightType type, int offset, int limit) {
        Objects.requireNonNull(faceitPlayerId, "faceitPlayerId");
        if (offset < 0 || limit < 0) {
            throw new IllegalArgumentException("offset and limit must not be negative: " + offset + ", " + limit);
        }
        Map<String, Object> params = new HashMap<>();
        StringBuilder filter = new StringBuilder(" AND p.faceit_id = :playerId");
        params.put("playerId", faceitPlayerId);
        filterByType(filter, params, type);
        params.put("offset", offset);
        params.put("limit", limit);
        return new HighlightPageResponse(withKills(select(filter + PLAYER_ORDER_AND_PAGE, params)), offset, limit);
    }

    /**
     * One highlight by its id, with its kills, under the rule of the lists: empty when there is no such highlight or
     * the demo of its match is not {@code ANALYZED}.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Optional<HighlightResponse> find(long highlightId) {
        return withKills(select(" AND h.id = :highlightId", Map.of("highlightId", highlightId))).stream().findFirst();
    }

    private static void filterByType(StringBuilder filter, Map<String, Object> params, HighlightType type) {
        if (type != null) {
            filter.append(" AND h.type = :type");
            params.put("type", type.name());
        }
    }

    /**
     * The rows of {@code HIGHLIGHTS_SQL} narrowed by {@code filterAndOrder}. A row of an unknown type is left out
     * (it still takes its place in a page's {@code LIMIT} and {@code OFFSET}), and the request logs one WARN for them.
     */
    private List<Row> select(String filterAndOrder, Map<String, Object> params) {
        Set<String> unknownTypes = new TreeSet<>();
        List<Row> rows = jdbc.sql(HIGHLIGHTS_SQL + filterAndOrder)
                .param("analyzed", DemoStatus.ANALYZED.name())
                .params(params)
                .query((rs, rowNumber) -> row(rs, unknownTypes))
                .list().stream()
                .filter(Objects::nonNull)
                .toList();
        if (!unknownTypes.isEmpty()) {
            log.warn("Skipping the highlights of types this version does not know: {}", unknownTypes);
        }
        return rows;
    }

    /** One statement for the kills of every highlight of the list, none when the list is empty. */
    private List<HighlightResponse> withKills(List<Row> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<Long, List<HighlightKill>> kills = jdbc.sql(KILLS_SQL)
                .param("ids", rows.stream().map(Row::id).toList())
                .query(HighlightQueryService::killRow)
                .list().stream()
                .collect(Collectors.groupingBy(KillRow::highlightId,
                        Collectors.mapping(KillRow::kill, Collectors.toList())));
        return rows.stream().map(row -> row.toResponse(kills.getOrDefault(row.id(), List.of()))).toList();
    }

    /** The current row as a {@link Row}, or {@code null} when its type is unknown (the name is added to the set). */
    private static Row row(ResultSet rs, Set<String> unknownTypes) throws SQLException {
        String typeName = rs.getString("type");
        HighlightType type = knownType(typeName);
        if (type == null) {
            unknownTypes.add(typeName);
            return null;
        }
        int tickStart = rs.getInt("tick_start");
        int tickEnd = rs.getInt("tick_end");
        Integer tickRate = rs.getObject("tick_rate", Integer.class);
        Side side = Side.fromDatabase(rs.getString("side"));
        OffsetDateTime startedAt = rs.getObject("started_at", OffsetDateTime.class);
        return new Row(rs.getLong("id"), type,
                rs.getString("player_faceit_id"), rs.getString("nickname"), rs.getInt("round_number"),
                side == null ? null : side.name(), tickStart, tickEnd, rs.getInt("round_start_tick"),
                rs.getInt("round_end_tick"), durationSeconds(tickStart, tickEnd, tickRate),
                rs.getString("faceit_match_id"), rs.getString("map_name"),
                startedAt == null ? null : startedAt.toInstant());
    }

    private static HighlightType knownType(String name) {
        for (HighlightType type : HighlightType.values()) {
            if (type.name().equals(name)) {
                return type;
            }
        }
        return null;
    }

    private static KillRow killRow(ResultSet rs, int rowNumber) throws SQLException {
        return new KillRow(rs.getLong("highlight_id"), new HighlightKill(rs.getInt("tick"), rs.getString("weapon"),
                rs.getBoolean("headshot"), rs.getString("victim_nickname")));
    }

    /** The length of the clip in whole seconds, rounded to the nearest; a demo with no tick rate is read at 64. */
    private static int durationSeconds(int tickStart, int tickEnd, Integer tickRate) {
        int ticksPerSecond = tickRate != null && tickRate > 0 ? tickRate : AnalysisPersistence.DEFAULT_TICK_RATE;
        return (int) Math.max(0L, Math.round((double) (tickEnd - tickStart) / ticksPerSecond));
    }

    /** A highlight as the first statement reads it, before its kills are known. */
    private record Row(long id, HighlightType type, String playerId, String nickname, int roundNumber, String side,
                       int tickStart, int tickEnd, int roundStartTick, int roundEndTick, int durationSeconds,
                       String matchId, String mapName, Instant startedAt) {

        HighlightResponse toResponse(List<HighlightKill> kills) {
            return new HighlightResponse(id, type, playerId, nickname, roundNumber, side, tickStart, tickEnd,
                    roundStartTick, roundEndTick, durationSeconds, kills, matchId, mapName, startedAt);
        }
    }

    private record KillRow(long highlightId, HighlightKill kill) {
    }
}
