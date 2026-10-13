package io.csfaceit.backend.clip;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.analysis.highlight.HighlightType;
import io.csfaceit.backend.clip.ClipFacts.KillRow;
import io.csfaceit.backend.clip.dto.ClipKill;
import io.csfaceit.backend.clip.dto.ClipPageResponse;
import io.csfaceit.backend.clip.dto.ClipResponse;
import io.csfaceit.backend.clip.dto.RecorderStatusResponse;
import io.csfaceit.backend.common.api.NotFoundException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
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
 * a player, and the finished ones; and the state of the recorder, which is read from the same tables. It only reads the
 * database: nothing here changes a clip, talks to FACEIT or touches the storage.
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

    /**
     * A clip as the endpoints that serve its files need it: {@code nickname}, {@code kind}, {@code highlightType} and
     * {@code roundNumber} name a download ({@code highlightType} and {@code roundNumber} are {@code null} in a
     * compilation), and {@code videoKey} and {@code thumbnailKey} are where the files are in the storage.
     */
    public record ClipMedia(ClipStatus status, ClipKind kind, String nickname, HighlightType highlightType,
                            Integer roundNumber, String videoKey, String thumbnailKey) {
    }

    private static final String CLIP_NOT_FOUND = "CLIP_NOT_FOUND";

    private static final int MILLIS_PER_SECOND = 1000;

    private static final TypeReference<List<ClipSegment>> SEGMENT_LIST = new TypeReference<>() {
    };

    private static final Logger log = LoggerFactory.getLogger(ClipQueryService.class);

    /**
     * Every clip with what the response names of its match and player. The position in the queue is the number of
     * queued clips that are not after the clip in the order a recorder takes them, {@code (created_at, id)}, so the
     * head of the queue is 1. The demo is a left join: only its tick rate is wanted, and a clip is listed whatever
     * became of its demo. {@code mine} is whether the clip was ordered by the reader, {@code :viewerId}, which is NULL
     * for a reader who is no signed-in user: the comparison is then NULL, and so is it for a clip nobody ordered.
     */
    private static final String CLIPS_SQL = """
            SELECT c.id, c.match_id, c.player_id, c.kind, c.status, c.progress, m.faceit_match_id, m.map_name,
                   p.faceit_id AS player_faceit_id, p.nickname, c.highlight_type, c.round_number, c.tick_start,
                   c.quality, c.fps, c.duration_ms, c.size_bytes, c.error, c.error_code, c.video_key, c.thumbnail_key,
                   c.created_at, c.finished_at, c.segments, d.tick_rate,
                   COALESCE(c.requested_by = CAST(:viewerId AS BIGINT), FALSE) AS mine,
                   CASE WHEN c.status = :queued THEN (
                       SELECT count(*) FROM clips q
                       WHERE q.status = :queued AND (q.created_at, q.id) <= (c.created_at, c.id)) END AS queue_position
            FROM clips c
            JOIN matches m ON m.id = c.match_id
            JOIN players p ON p.id = c.player_id
            LEFT JOIN demos d ON d.match_id = c.match_id""";

    /**
     * When the latest recorder was seen, and how many clips wait for one and how many are held by one. A sub-select
     * for each, so that one statement answers it whatever the tables hold.
     */
    private static final String RECORDER_STATUS_SQL = """
            SELECT (SELECT max(last_seen_at) FROM clip_workers) AS last_seen_at,
                   (SELECT count(*) FROM clips WHERE status = :queued) AS queued,
                   (SELECT count(*) FROM clips WHERE status IN (:active)) AS active""";

    private static final List<String> ACTIVE_STATUS_NAMES = Arrays.stream(ClipStatus.values())
            .filter(ClipStatus::isActive).map(ClipStatus::name).toList();

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
    private final Clock clock;

    public ClipQueryService(JdbcClient jdbc, ClipFacts facts, ClipProperties properties, ObjectMapper mapper,
                            Clock clock) {
        this.jdbc = jdbc;
        this.facts = facts;
        this.properties = properties;
        this.mapper = mapper;
        this.clock = clock;
    }

    /**
     * One clip with the kills its video shows ({@link ClipResponse#kills}), each at its place on the video's
     * timeline: the length of the segments before the one it is in, plus its distance from that segment's first tick,
     * in milliseconds (the ticks are turned into time with the tick rate of the demo).
     *
     * @param viewerId the id of the user whose session is reading, for {@link ClipResponse#mine}; {@code null} for
     *        anyone else (the same in every read below)
     * @throws NotFoundException {@code CLIP_NOT_FOUND}
     */
    public ClipResponse get(long clipId, Long viewerId) {
        Row row = find(clipId, viewerId);
        return row.toResponse(properties, kills(row));
    }

    /**
     * One clip without its kills, as the answer to a request for a clip carries it.
     *
     * @throws NotFoundException {@code CLIP_NOT_FOUND}
     */
    public ClipResponse summary(long clipId, Long viewerId) {
        return find(clipId, viewerId).toResponse(properties, List.of());
    }

    /**
     * What the video and the thumbnail of a clip are served from: the clip's status, what a download is named after,
     * and the keys of its files in the storage as the row holds them. A key is {@code null} while the clip has no such
     * file. Each attempt to record a clip uploads under keys of its own, and these are the ones of the attempt that
     * finished the clip.
     *
     * @throws NotFoundException {@code CLIP_NOT_FOUND}
     */
    public ClipMedia media(long clipId) {
        Row row = find(clipId, null);
        return new ClipMedia(row.status(), row.kind(), row.nickname(), row.highlightType(), row.roundNumber(),
                row.videoKey(), row.thumbnailKey());
    }

    /** Every clip of the match, whatever its status, the newest first. Empty for a match the database does not know. */
    public List<ClipResponse> forMatch(String faceitMatchId, Long viewerId) {
        return responses(select(BY_MATCH, Map.of("matchId", faceitMatchId), viewerId));
    }

    /**
     * A page of the clips of one player over all his matches, whatever their status, the newest first. Empty for a
     * player the database does not know.
     *
     * @param faceitPlayerId the FACEIT player id ({@code players.faceit_id})
     */
    public ClipPageResponse forPlayer(String faceitPlayerId, int offset, int limit, Long viewerId) {
        List<Row> rows = select(BY_PLAYER_PAGE, Map.of("playerId", faceitPlayerId, "offset", offset, "limit", limit),
                viewerId);
        return new ClipPageResponse(responses(rows), offset, limit);
    }

    /** A page of the clips that are {@code DONE}, the most recently finished first. */
    public ClipPageResponse latest(int offset, int limit, Long viewerId) {
        List<Row> rows = select(FINISHED_PAGE,
                Map.of("done", ClipStatus.DONE.name(), "offset", offset, "limit", limit), viewerId);
        return new ClipPageResponse(responses(rows), offset, limit);
    }

    /**
     * Whether a recorder is there to take the clips that wait: some recorder was seen within
     * {@code clip.worker-online-within}. With the time it was last seen, and the clips waiting and being recorded.
     */
    public RecorderStatusResponse recorderStatus() {
        return jdbc.sql(RECORDER_STATUS_SQL)
                .param("queued", ClipStatus.QUEUED.name())
                .param("active", ACTIVE_STATUS_NAMES)
                .query((rs, rowNumber) -> {
                    OffsetDateTime seen = rs.getObject("last_seen_at", OffsetDateTime.class);
                    Instant lastSeenAt = seen == null ? null : seen.toInstant();
                    boolean online = lastSeenAt != null
                            && lastSeenAt.isAfter(clock.instant().minus(properties.workerOnlineWithin()));
                    return new RecorderStatusResponse(online, lastSeenAt, rs.getInt("queued"), rs.getInt("active"));
                })
                .single();
    }

    private Row find(long clipId, Long viewerId) {
        return select(BY_ID, Map.of("clipId", clipId), viewerId).stream().findFirst()
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
    private List<Row> select(String filterAndOrder, Map<String, Object> params, Long viewerId) {
        Map<String, Object> all = new HashMap<>(params);
        all.put("queued", ClipStatus.QUEUED.name());
        all.put("viewerId", viewerId);
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
                ClipErrorCode.fromName(rs.getString("error_code")), rs.getString("video_key"),
                rs.getString("thumbnail_key"), rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                finishedAt == null ? null : finishedAt.toInstant(), rs.getString("segments"),
                ClipFacts.tickRate(nullableInt(rs, "tick_rate")), nullableInt(rs, "queue_position"),
                rs.getBoolean("mine"));
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
                       Long sizeBytes, String error, ClipErrorCode errorCode, String videoKey, String thumbnailKey,
                       Instant createdAt, Instant finishedAt, String segmentsJson, int tickRate,
                       Integer queuePosition, boolean mine) {

        ClipResponse toResponse(ClipProperties properties, List<ClipKill> kills) {
            boolean done = status == ClipStatus.DONE;
            Instant expiresAt = done && finishedAt != null && properties.retentionDays() > 0
                    ? finishedAt.plus(properties.retentionDays(), ChronoUnit.DAYS) : null;
            return new ClipResponse(id, kind, status, progress, matchId, mapName, playerId, nickname, highlightType,
                    roundNumber, tickStart, quality, fps, durationMs, sizeBytes, error,
                    errorCode, status == ClipStatus.QUEUED ? queuePosition : null,
                    done ? "/api/v1/clips/" + id + "/video" : null,
                    done && thumbnailKey != null ? "/api/v1/clips/" + id + "/thumbnail" : null,
                    createdAt, finishedAt, expiresAt, kills, mine);
        }
    }
}
