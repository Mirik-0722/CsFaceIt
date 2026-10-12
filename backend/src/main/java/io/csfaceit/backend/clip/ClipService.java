package io.csfaceit.backend.clip;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.analysis.AnalysisPersistence;
import io.csfaceit.backend.analysis.api.HighlightQueryService;
import io.csfaceit.backend.analysis.api.dto.HighlightResponse;
import io.csfaceit.backend.analysis.highlight.HighlightType;
import io.csfaceit.backend.clip.ClipFacts.KillRow;
import io.csfaceit.backend.clip.ClipPersistence.HighlightKey;
import io.csfaceit.backend.clip.dto.ClipKill;
import io.csfaceit.backend.clip.dto.ClipPageResponse;
import io.csfaceit.backend.clip.dto.ClipResponse;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.common.api.TooManyRequestsException;
import io.csfaceit.backend.demo.Demo;
import io.csfaceit.backend.demo.DemoRepository;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.player.Player;
import io.csfaceit.backend.player.PlayerRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Takes the requests for clips and answers the questions about them. Like {@code DemoService} it opens no transaction
 * itself: the facts are read and the segments worked out with none open, and the short database steps are the
 * transactions of {@link ClipPersistence}. A clip, and a whole list of clips, is read with one statement that joins in
 * the match, the map and the player, so nothing here asks for the same thing once for each clip; only the page of one
 * clip adds a statement for its kills.
 *
 * <p>A clip is requested for a highlight and a quality. The highlight is read only through
 * {@link HighlightQueryService#find}, which knows when a highlight may be served (while the demo of its match is
 * {@code ANALYZED}); the clip is tied to it by the highlight's natural key and not by its id, so a new analysis of the
 * demo does not cut the clip off from its highlight.
 */
@Service
public class ClipService {

    /** What a request for a clip came to: the clip, and whether this request is the one that queued it. */
    public record ClipCreation(ClipResponse clip, boolean created) {
    }

    private static final String HIGHLIGHT_NOT_FOUND = "HIGHLIGHT_NOT_FOUND";
    private static final String DEMO_NOT_AVAILABLE = "DEMO_NOT_AVAILABLE";
    private static final String PLAYER_STEAM_ID_UNKNOWN = "PLAYER_STEAM_ID_UNKNOWN";
    private static final String CLIP_QUEUE_FULL = "CLIP_QUEUE_FULL";
    private static final String CLIP_TOO_LONG = "CLIP_TOO_LONG";
    private static final String CLIP_NOT_FOUND = "CLIP_NOT_FOUND";

    private static final int MILLIS_PER_SECOND = 1000;

    private static final TypeReference<List<ClipSegment>> SEGMENT_LIST = new TypeReference<>() {
    };

    private static final Logger log = LoggerFactory.getLogger(ClipService.class);

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

    private final HighlightQueryService highlights;
    private final MatchRepository matches;
    private final PlayerRepository players;
    private final DemoRepository demos;
    private final ClipFacts facts;
    private final ClipPersistence persistence;
    private final ClipProperties properties;
    private final JdbcClient jdbc;
    private final ObjectMapper mapper;

    public ClipService(HighlightQueryService highlights, MatchRepository matches, PlayerRepository players,
                       DemoRepository demos, ClipFacts facts, ClipPersistence persistence,
                       ClipProperties properties, JdbcClient jdbc, ObjectMapper mapper) {
        this.highlights = highlights;
        this.matches = matches;
        this.players = players;
        this.demos = demos;
        this.facts = facts;
        this.persistence = persistence;
        this.properties = properties;
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /**
     * Queues the clip of a highlight at a quality, or answers with the clip that already stands for it. The checks
     * come in this order, and the first that fails ends the request:
     * <ol>
     *   <li>the highlight is read (see {@link HighlightQueryService#find}): there is none, or its demo is not
     *       {@code ANALYZED}
     *   <li>the file of the demo is stored, and the player's SteamID is known: a recorder follows a player by it
     *   <li>a clip of this highlight and quality that is not {@code FAILED} exists: it is the answer
     *   <li>the queue has room
     *   <li>the segments, worked out from the player's kills in the highlight's window, are not longer than
     *       {@code clip.max-duration-seconds}
     * </ol>
     * Repeating a request, also in parallel, therefore leaves one clip. The queue limit is soft: the count and the
     * insert are not one step, so two requests at the limit may both get in.
     *
     * @throws NotFoundException {@code HIGHLIGHT_NOT_FOUND}
     * @throws ConflictException {@code DEMO_NOT_AVAILABLE}, {@code PLAYER_STEAM_ID_UNKNOWN} or {@code CLIP_TOO_LONG}
     * @throws TooManyRequestsException {@code CLIP_QUEUE_FULL}
     */
    public ClipCreation requestHighlightClip(long highlightId, ClipQuality quality) {
        HighlightResponse highlight = highlights.find(highlightId).orElseThrow(() -> highlightNotFound(highlightId));
        // The highlight was read from rows that join its match, its player and its demo, so they are there; a row that
        // has gone since is the highlight having gone.
        Match match = matches.findByFaceitMatchId(highlight.matchId())
                .orElseThrow(() -> highlightNotFound(highlightId));
        Player player = players.findByFaceitId(highlight.playerId())
                .orElseThrow(() -> highlightNotFound(highlightId));
        int tickRate = tickRateOfRecordableDemo(match, player);

        HighlightKey key = new HighlightKey(match.getId(), player.getId(), highlight.type(), highlight.roundNumber(),
                highlight.tickStart(), quality);
        Optional<Long> existing = persistence.findLiveHighlightClip(key);
        if (existing.isPresent()) {
            return new ClipCreation(read(existing.get()), false);
        }
        if (persistence.countQueued() >= properties.maxQueued()) {
            throw new TooManyRequestsException(CLIP_QUEUE_FULL,
                    "The clip queue is full (" + properties.maxQueued() + " clips are waiting), try again later");
        }
        List<Integer> killTicks = facts.killTicks(match.getId(), player.getId(), highlight.roundNumber(),
                highlight.tickStart(), highlight.tickEnd());
        List<ClipSegment> segments = SegmentBuilder.build(killTicks, highlight.tickStart(), highlight.tickEnd(),
                tickRate, properties);
        rejectIfTooLong(segments, tickRate);

        long clipId;
        try {
            clipId = persistence.queueHighlightClip(key, highlight.tickEnd(), properties.fps(), segments);
        } catch (DataIntegrityViolationException e) {
            // A concurrent request queued the same clip between the look above and the insert, and the unique index
            // let only one of them in. The loser's transaction is aborted; the clip it was after is the winner's.
            Optional<Long> winner = persistence.findLiveHighlightClip(key);
            if (winner.isEmpty()) {
                throw e;
            }
            log.info("Lost a concurrent request for the clip of highlight {} at {}, answering with clip {}",
                    highlightId, quality.label(), winner.get());
            return new ClipCreation(read(winner.get()), false);
        }
        log.info("Queued clip {} at {} for highlight {} ({} of {}, round {}): {} segment(s), {} ticks", clipId,
                quality.label(), highlightId, highlight.type(), highlight.matchId(), highlight.roundNumber(),
                segments.size(), SegmentBuilder.totalTicks(segments));
        return new ClipCreation(read(clipId), true);
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

    /**
     * The tick rate of the demo of the match, provided a recorder can be given its file: a stored file, and a demo
     * that is parsed (or analyzed). Then the player: a recorder follows him by his SteamID, which a player known only
     * from FACEIT may not have.
     *
     * @throws ConflictException {@code DEMO_NOT_AVAILABLE} or {@code PLAYER_STEAM_ID_UNKNOWN}
     */
    private int tickRateOfRecordableDemo(Match match, Player player) {
        Demo demo = demos.findByMatchId(match.getId())
                .filter(ClipService::hasStoredFile)
                .orElseThrow(() -> new ConflictException(DEMO_NOT_AVAILABLE,
                        "The demo file of match " + match.getFaceitMatchId() + " is not stored (any more)"));
        if (player.getSteamId() == null || player.getSteamId().isBlank()) {
            throw new ConflictException(PLAYER_STEAM_ID_UNKNOWN, "The SteamID of player " + player.getFaceitId()
                    + " is not known, so he cannot be followed in a demo");
        }
        return tickRate(demo.getTickRate());
    }

    private static boolean hasStoredFile(Demo demo) {
        return demo.getStorageKey() != null
                && (demo.getStatus() == DemoStatus.PARSED || demo.getStatus() == DemoStatus.ANALYZED);
    }

    /** A demo whose parser could not tell its tick rate is read at the default one. */
    private static int tickRate(Integer demoTickRate) {
        return demoTickRate != null && demoTickRate > 0 ? demoTickRate : AnalysisPersistence.DEFAULT_TICK_RATE;
    }

    private void rejectIfTooLong(List<ClipSegment> segments, int tickRate) {
        long ticks = SegmentBuilder.totalTicks(segments);
        if (ticks > (long) properties.maxDurationSeconds() * tickRate) {
            // Rounded up, so that the length named is above the limit named.
            long seconds = (long) Math.ceil((double) ticks / tickRate);
            throw new ConflictException(CLIP_TOO_LONG, "The clip would be " + seconds
                    + " seconds long; the longest allowed is " + properties.maxDurationSeconds() + " seconds");
        }
    }

    private static NotFoundException highlightNotFound(long highlightId) {
        return new NotFoundException(HIGHLIGHT_NOT_FOUND, "Highlight not found: " + highlightId);
    }

    /** The clip as a response without its kills, for the answer to a request. */
    private ClipResponse read(long clipId) {
        return find(clipId).toResponse(properties, List.of());
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

    private List<Row> select(String filterAndOrder, Map<String, Object> params) {
        Map<String, Object> all = new HashMap<>(params);
        all.put("queued", ClipStatus.QUEUED.name());
        return jdbc.sql(CLIPS_SQL + filterAndOrder)
                .params(all)
                .query(ClipService::row)
                .list();
    }

    private static Row row(ResultSet rs, int rowNumber) throws SQLException {
        String highlightType = rs.getString("highlight_type");
        OffsetDateTime finishedAt = rs.getObject("finished_at", OffsetDateTime.class);
        return new Row(rs.getLong("id"), rs.getLong("match_id"), rs.getLong("player_id"),
                ClipKind.valueOf(rs.getString("kind")), ClipStatus.valueOf(rs.getString("status")),
                rs.getInt("progress"), rs.getString("faceit_match_id"), rs.getString("map_name"),
                rs.getString("player_faceit_id"), rs.getString("nickname"),
                highlightType == null ? null : HighlightType.valueOf(highlightType),
                nullableInt(rs, "round_number"), nullableInt(rs, "tick_start"),
                ClipQuality.fromLabel(rs.getString("quality")), rs.getInt("fps"), nullableInt(rs, "duration_ms"),
                nullableLong(rs, "size_bytes"), rs.getString("error"), rs.getString("thumbnail_key") != null,
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                finishedAt == null ? null : finishedAt.toInstant(), rs.getString("segments"),
                tickRate(nullableInt(rs, "tick_rate")), nullableInt(rs, "queue_position"));
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
