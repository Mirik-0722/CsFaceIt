package io.csfaceit.backend.clip;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.analysis.highlight.HighlightType;
import io.csfaceit.backend.clip.ClipFacts.KillRow;
import io.csfaceit.backend.clip.dto.ClipKill;
import io.csfaceit.backend.clip.dto.ClipPageResponse;
import io.csfaceit.backend.clip.dto.ClipResponse;
import io.csfaceit.backend.common.api.NotFoundException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Reads clips for the REST API, as {@code HighlightQueryService} reads highlights: one clip, the clips of a match, of
 * a player, and the finished ones. It only reads the database: nothing here changes a clip, talks to FACEIT or
 * touches the storage.
 *
 * <p>A clip, and a whole list of clips, is read with one statement that joins in the match, the map and the player,
 * so nothing here asks for the same thing once for each clip; only the page of one clip adds a statement for its
 * kills.
 *
 * <p>A row that holds a kind, a status, a quality or a highlight type this version does not know (the database was
 * rolled back from a later version) is left out, with one WARN naming the values for each request that meets one;
 * the rest of the list is served. It still takes its place in the {@code LIMIT} and {@code OFFSET} of a page. A single
 * clip like that is a 404, as if it were not there.
 */
@Service
public class ClipQueryService {

    private static final String CLIP_NOT_FOUND = "CLIP_NOT_FOUND";

    private static final int MILLIS_PER_SECOND = 1000;

    private static final TypeReference<List<ClipSegment>> SEGMENT_LIST = new TypeReference<>() {
    };

    private static final Logger log = LoggerFactory.getLogger(ClipQueryService.class);

    /**
     * Every clip with what the response names of its match and player. The position in the queue is the number of
     * queued clips that are not after the clip in the order a recorder takes them, {@code (created_at, id)}, so the
     * head of the queue is 1. The demo is a left join: only its tick rate is wanted, and a clip is listed whatever
     * became of its demo.
     */
    private static final String CLIPS_SQL = """
            SELECT c.id, c.match_id, c.player_id, c.kind, c.status, c.progress, m.faceit_match_id, m.map_name,
                   p.faceit_id AS player_faceit_id, p.nickname, c.highlight_type, c.round_number, c.tick_start,
                   c.quality, c.fps, c.duration_ms, c.size_bytes, c.error, c.thumbnail_key, c.created_at,
                   c.finished_at, c.segments, d.tick_rate,
                   CASE WHEN c.status = :queued THEN (
                       SELECT count(*) FROM clips q
                       WHERE q.status = :queued AND (q.created_at, q.id) <= (c.created_at, c.id)) END AS queue_position
            FROM clips c
            JOIN matches m ON m.id = c.match_id
            JOIN players p ON p.id = c.player_id
            LEFT JOIN demos d ON d.match_id = c.match_id""";

    private static final String BY_ID = " WHERE c.id = :clipId";

    private static final String BY_MATCH = " WHERE m.faceit_match_id = :matchId ORDER BY c.created_at DESC, c.id DESC";

    /** The id comes last so that a page boundary falls in the same place on every request. */
    private static final String BY_PLAYER_PAGE = " WHERE p.faceit_id = :playerId"
            + " ORDER BY c.created_at DESC, c.id DESC LIMIT :limit OFFSET :offset";

    private static final String FINISHED_PAGE = " WHERE c.status = :done"
            + " ORDER BY c.finished_at DESC NULLS LAST, c.id DESC LIMIT :limit OFFSET :offset";

    private final JdbcClient jdbc;
    private final ClipFacts facts;
    private final ClipProperties properties;
    private final ObjectMapper mapper;

    public ClipQueryService(JdbcClient jdbc, ClipFacts facts, ClipProperties properties, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.facts = facts;
        this.properties = properties;
        this.mapper = mapper;
    }

    /**
     * One clip with the kills its video shows ({@link ClipResponse#kills}), each at its place on the video's
     * timeline: the length of the segments before the one it is in, plus its distance from that segment's first tick,
     * in milliseconds (the ticks are turned into time with the tick rate of the demo).
     *
     * @throws NotFoundException {@code CLIP_NOT_FOUND}
     */
    public ClipResponse get(long clipId) {
        Row row = find(clipId);
        return row.toResponse(properties, kills(row));
    }

    /**
     * One clip without its kills, as the answer to a request for a clip carries it.
     *
     * @throws NotFoundException {@code CLIP_NOT_FOUND}
     */
    public ClipResponse summary(long clipId) {
        return find(clipId).toResponse(properties, List.of());
    }

    /** Every clip of the match, whatever its status, the newest first. Empty for a match the database does not know. */
    public List<ClipResponse> forMatch(String faceitMatchId) {
        return responses(select(BY_MATCH, Map.of("matchId", faceitMatchId)));
    }

    /**
     * A page of the clips of one player over all his matches, whatever their status, the newest first. Empty for a
     * player the database does not know.
     *
     * @param faceitPlayerId the FACEIT player id ({@code players.faceit_id})
     */
    public ClipPageResponse forPlayer(String faceitPlayerId, int offset, int limit) {
        List<Row> rows = select(BY_PLAYER_PAGE, Map.of("playerId", faceitPlayerId, "offset", offset, "limit", limit));
        return new ClipPageResponse(responses(rows), offset, limit);
    }

    /** A page of the clips that are {@code DONE}, the most recently finished first. */
    public ClipPageResponse latest(int offset, int limit) {
        List<Row> rows = select(FINISHED_PAGE,
                Map.of("done", ClipStatus.DONE.name(), "offset", offset, "limit", limit));
        return new ClipPageResponse(responses(rows), offset, limit);
    }

    private Row find(long clipId) {
        return select(BY_ID, Map.of("clipId", clipId)).stream().findFirst()
                .orElseThrow(() -> new NotFoundException(CLIP_NOT_FOUND, "Clip not found: " + clipId));
    }

    private List<ClipResponse> responses(List<Row> rows) {
        return rows.stream().map(row -> row.toResponse(properties, List.of())).toList();
    }

    /**
     * The kills of the clip, on the timeline of the video. One statement reads the player's kills from the first
     * tick of the first segment to the last tick of the last, and each is placed in the segment it falls in; a kill in
     * a gap between two segments is not in the video.
     */
    private List<ClipKill> kills(Row row) {
        List<ClipSegment> segments = segments(row);
        if (segments.isEmpty()) {
            return List.of();
        }
        List<KillRow> killRows = facts.killsIn(row.matchRowId(), row.playerRowId(), segments.get(0).startTick(),
                segments.get(segments.size() - 1).endTick());
        List<ClipKill> placed = new ArrayList<>();
        long videoTicksBefore = 0;
        int next = 0;
        for (ClipSegment segment : segments) {
            while (next < killRows.size() && killRows.get(next).tick() < segment.startTick()) {
                next++;
            }
            for (; next < killRows.size() && killRows.get(next).tick() <= segment.endTick(); next++) {
                KillRow kill = killRows.get(next);
                long offsetTicks = videoTicksBefore + (kill.tick() - segment.startTick());
                placed.add(new ClipKill(milliseconds(offsetTicks, row.tickRate()), kill.weapon(), kill.headshot(),
                        kill.victimNickname()));
            }
            videoTicksBefore += segment.endTick() - segment.startTick();
        }
        return placed;
    }

    private static int milliseconds(long ticks, int tickRate) {
        return (int) Math.round((double) ticks * MILLIS_PER_SECOND / tickRate);
    }

    private List<ClipSegment> segments(Row row) {
        try {
            return mapper.readValue(row.segmentsJson(), SEGMENT_LIST);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("The segments of clip " + row.id() + " cannot be read", e);
        }
    }

    /**
     * The rows of {@code CLIPS_SQL} narrowed by {@code filterAndOrder}. A row with a value this version does not know
     * is left out, and the request logs one WARN for them.
     */
    private List<Row> select(String filterAndOrder, Map<String, Object> params) {
        Map<String, Object> all = new HashMap<>(params);
        all.put("queued", ClipStatus.QUEUED.name());
        Set<String> unknown = new TreeSet<>();
        List<Row> rows = jdbc.sql(CLIPS_SQL + filterAndOrder)
                .params(all)
                .query((rs, rowNumber) -> row(rs, unknown))
                .list().stream()
                .filter(Objects::nonNull)
                .toList();
        if (!unknown.isEmpty()) {
            log.warn("Skipping the clips that hold values this version does not know: {}", unknown);
        }
        return rows;
    }

    /**
     * The current row as a {@link Row}, or {@code null} when it holds a kind, status, quality or highlight type this
     * version does not know; each such value is added to the set, as {@code column=value}.
     */
    private static Row row(ResultSet rs, Set<String> unknown) throws SQLException {
        ClipKind kind = known(ClipKind.class, "kind", rs.getString("kind"), unknown);
        ClipStatus status = known(ClipStatus.class, "status", rs.getString("status"), unknown);
        ClipQuality quality = knownQuality(rs.getString("quality"), unknown);
        String highlightTypeName = rs.getString("highlight_type");
        HighlightType highlightType = highlightTypeName == null ? null
                : known(HighlightType.class, "highlight_type", highlightTypeName, unknown);
        if (kind == null || status == null || quality == null
                || (highlightTypeName != null && highlightType == null)) {
            return null;
        }
        OffsetDateTime finishedAt = rs.getObject("finished_at", OffsetDateTime.class);
        return new Row(rs.getLong("id"), rs.getLong("match_id"), rs.getLong("player_id"), kind, status,
                rs.getInt("progress"), rs.getString("faceit_match_id"), rs.getString("map_name"),
                rs.getString("player_faceit_id"), rs.getString("nickname"), highlightType,
                nullableInt(rs, "round_number"), nullableInt(rs, "tick_start"), quality, rs.getInt("fps"),
                nullableInt(rs, "duration_ms"), nullableLong(rs, "size_bytes"), rs.getString("error"),
                rs.getString("thumbnail_key") != null, rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                finishedAt == null ? null : finishedAt.toInstant(), rs.getString("segments"),
                ClipFacts.tickRate(nullableInt(rs, "tick_rate")), nullableInt(rs, "queue_position"));
    }

    /** The constant of that name, or {@code null} when there is none; the value is then added to the set. */
    private static <E extends Enum<E>> E known(Class<E> type, String column, String name, Set<String> unknown) {
        try {
            return Enum.valueOf(type, name);
        } catch (IllegalArgumentException e) {
            unknown.add(column + "=" + name);
            return null;
        }
    }

    /** The quality with that label, or {@code null} when there is none; the value is then added to the set. */
    private static ClipQuality knownQuality(String label, Set<String> unknown) {
        try {
            return ClipQuality.fromLabel(label);
        } catch (IllegalArgumentException e) {
            unknown.add("quality=" + label);
            return null;
        }
    }

    private static Integer nullableInt(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    /** A clip as the statement reads it, with what {@code get} needs to place its kills and a response lacks. */
    private record Row(long id, long matchRowId, long playerRowId, ClipKind kind, ClipStatus status, int progress,
                       String matchId, String mapName, String playerId, String nickname, HighlightType highlightType,
                       Integer roundNumber, Integer tickStart, ClipQuality quality, int fps, Integer durationMs,
                       Long sizeBytes, String error, boolean hasThumbnail, Instant createdAt, Instant finishedAt,
                       String segmentsJson, int tickRate, Integer queuePosition) {

        ClipResponse toResponse(ClipProperties properties, List<ClipKill> kills) {
            boolean done = status == ClipStatus.DONE;
            Instant expiresAt = done && finishedAt != null && properties.retentionDays() > 0
                    ? finishedAt.plus(properties.retentionDays(), ChronoUnit.DAYS) : null;
            return new ClipResponse(id, kind, status, progress, matchId, mapName, playerId, nickname, highlightType,
                    roundNumber, tickStart, quality, fps, durationMs, sizeBytes, error,
                    status == ClipStatus.QUEUED ? queuePosition : null,
                    done ? "/api/v1/clips/" + id + "/video" : null,
                    done && hasThumbnail ? "/api/v1/clips/" + id + "/thumbnail" : null,
                    createdAt, finishedAt, expiresAt, kills);
        }
    }
}
