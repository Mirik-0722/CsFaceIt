package io.csfaceit.backend.player;

import io.csfaceit.backend.clip.ClipStatus;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.dto.FaceitPlayerMatchStats;
import io.csfaceit.backend.match.DemoScoreboard;
import io.csfaceit.backend.match.MatchSource;
import io.csfaceit.backend.player.dto.ClipCounts;
import io.csfaceit.backend.player.dto.HighlightCount;
import io.csfaceit.backend.player.dto.MapResult;
import io.csfaceit.backend.player.dto.MatchHistoryResponse;
import io.csfaceit.backend.player.dto.MatchResult;
import io.csfaceit.backend.player.dto.MatchSummary;
import io.csfaceit.backend.player.dto.PlayerMatchListResponse;
import io.csfaceit.backend.player.dto.PlayerMatchResponse;
import io.csfaceit.backend.player.dto.PlayerOverviewResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The two reads behind the player page and the list of matches: the player's results by map and his highlights by
 * type, and what the backend knows of each match of a page of his FACEIT history. The transactional reads use the
 * database only; the history itself comes from {@link PlayerService#getHistory}, which the caller runs first and with no
 * transaction open, so that a connection is never held while FACEIT is waited for. For the same reason the map and the
 * numbers of the matches the site has not stored are taken from FACEIT afterwards, by {@link #withFaceitStats}.
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
 *   <li>The person's matchmaking matches ({@code mm-<id>}, which FACEIT's history does not have) are read from the
 *       database in the same transaction, a few statements more for the whole page: the matches themselves with his
 *       numbers, and their score and teams ({@link DemoScoreboard}). A player known only from demos
 *       ({@code steam:<SteamID>}) has a list of those alone.
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

    /**
     * The matchmaking matches of a person, newest first: those whose demo has him among its players (his row,
     * {@code players.faceit_id = :playerId}) and those a user brought in who is him (the user linked to his row, the
     * user with his row's SteamID, or the user with {@code :ownSteamId}, which is how a {@code steam:} player is known
     * before any demo of his is parsed). A match is listed at its start, or at the moment its demo arrived when the start
     * is not known; a match with neither is listed last. The range and the page are added by
     * {@link #matchmakingRows}. The player's row of statistics and the demo are left joins, as in
     * {@link #MATCH_FACTS_SQL}.
     *
     * <p>A demo's players are trusted only once the demo is {@code ANALYZED} (the wrong-demo check runs between
     * {@code PARSED} and {@code ANALYZED}, and a {@code WRONG_MATCH} demo keeps the parser's rows): before that a match is
     * on nobody's list by its players, and his numbers are not read. Its owner still finds it in his list, with the
     * demo's status, so that he sees what became of the demo he brought.
     *
     * <p>The person's matches are found first, by index, and only they are then read, ranged, ordered and paged:
     * {@code own} joins two lookups with {@code UNION} (which also drops a match found by both), the matches brought in
     * by the users who are him ({@code idx_matches_owner}, the users themselves by {@code idx_users_player} and their
     * unique SteamID) and the matches of the {@code ANALYZED} demos he is among the players of
     * ({@code idx_round_players_player}). One condition joining the two with {@code OR} could only be checked match by
     * match, which read every matchmaking match of the database for each list. No index serves the range or the order:
     * the time a match is listed at is taken across the join with its demo, and it is worked out for the person's own
     * matches only.
     */
    private static final String MATCHMAKING_ROWS_SQL = """
            WITH person AS (SELECT id, steam_id FROM players WHERE faceit_id = :playerId),
            owners AS (
                SELECT u.id
                FROM users u
                WHERE u.player_id = (SELECT id FROM person)
                   OR u.steam_id = (SELECT steam_id FROM person)
                   OR u.steam_id = :ownSteamId),
            own AS (
                SELECT m.id AS match_id
                FROM matches m
                WHERE m.owner_user_id IN (SELECT id FROM owners)
                UNION
                SELECT d.match_id
                FROM demos d
                WHERE d.status = 'ANALYZED'
                  AND d.match_id IN (SELECT rp.match_id FROM round_players rp
                                     WHERE rp.player_id = (SELECT id FROM person)))
            SELECT m.id, m.faceit_match_id, m.map_name, m.finished_at,
                   coalesce(m.started_at, d.created_at) AS listed_at,
                   s.kills, s.deaths, s.assists,
                   CASE WHEN s.rounds_played IS NOT NULL THEN s.adr END AS adr,
                   d.status AS demo_status
            FROM own o
            JOIN matches m ON m.id = o.match_id
            LEFT JOIN demos d ON d.match_id = m.id
            LEFT JOIN player_match_stats s ON s.match_id = m.id AND s.player_id = (SELECT id FROM person)
                                          AND d.status = 'ANALYZED'
            WHERE m.source = 'MATCHMAKING'""";

    private static final String MATCHMAKING_ORDER = " ORDER BY listed_at DESC NULLS LAST, m.id DESC";

    private static final String PERSON_ROW_SQL = "SELECT id FROM players WHERE faceit_id = :playerId";

    /** Not {@link ClipStatus#isActive()}: that one leaves out the clips still waiting in the queue. */
    private static final List<String> ACTIVE_CLIP_STATUSES = Arrays.stream(ClipStatus.values())
            .filter(status -> status != ClipStatus.DONE && status != ClipStatus.FAILED)
            .map(ClipStatus::name)
            .toList();

    private static final ClipCounts NO_CLIPS = new ClipCounts(0, 0, 0);

    /**
     * How many places before a page of the history the window of FACEIT's per-match statistics starts, and how far past
     * it it reaches (see {@link #withFaceitStats}).
     */
    private static final int STATS_MARGIN = 20;

    /**
     * The block FACEIT's per-match statistics are read in: FACEIT answers 400 when the offset is not a multiple of the
     * limit (seen 2026-10-15: {@code offset=20&limit=40} is refused, {@code offset=40&limit=20} is not), so the window is
     * read as the whole blocks of this size that cover it — one, or two where it crosses a block's end. 100 is the
     * most FACEIT lists at once.
     */
    private static final int STATS_BLOCK = 100;

    private static final Logger log = LoggerFactory.getLogger(PlayerOverviewService.class);

    private final JdbcClient jdbc;
    private final DemoScoreboard scoreboard;
    private final FaceitGateway faceit;

    public PlayerOverviewService(JdbcClient jdbc, DemoScoreboard scoreboard, FaceitGateway faceit) {
        this.jdbc = jdbc;
        this.scoreboard = scoreboard;
        this.faceit = faceit;
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
     * The page of the player's history with what the database knows of each of its matches, in the order of the page,
     * and the same person's matchmaking matches that fall into the page's stretch of time merged in by start (see
     * {@link #matchmakingRange}). A page with no match and no matchmaking match reads only the matchmaking list.
     *
     * @param faceitPlayerId the FACEIT player id the history was asked for
     * @param history the page {@link PlayerService#getHistory} returned for him
     * @param before the start of the last row of the page before this one, as the page holds it; {@code null} for the
     *        first page
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PlayerMatchListResponse matches(String faceitPlayerId, MatchHistoryResponse history, Instant before) {
        Optional<Range> range = matchmakingRange(history, before);
        // With no lower end (the last page of FACEIT's history) the matchmaking matches are paged too: at most a page
        // of them, the newest first, and the next request (before = the start of the last row) goes on from there.
        boolean capped = range.map(r -> r.from() == null).orElse(false);
        List<MatchmakingRow> matchmaking = range
                .map(r -> matchmakingRows(faceitPlayerId, "", r.from(), r.to(), capped ? 0 : null,
                        capped ? history.limit() : null))
                .orElse(List.of());
        List<MatchSummary> page = history.items();
        if (capped && matchmaking.size() == history.limit()) {
            page = linesNotOlderThan(page, matchmaking.get(matchmaking.size() - 1).listedAt());
        }
        if (page.isEmpty() && matchmaking.isEmpty()) {
            return new PlayerMatchListResponse(List.of(), history.offset(), history.limit());
        }
        List<String> matchIds = new ArrayList<>(page.stream().map(MatchSummary::matchId).toList());
        matchmaking.forEach(row -> matchIds.add(row.matchId()));
        Map<String, StoredMatch> stored = page.isEmpty() ? Map.of()
                : storedMatches(faceitPlayerId, page.stream().map(MatchSummary::matchId).toList());
        Map<String, List<HighlightCount>> highlights = highlightsByMatch(faceitPlayerId, matchIds);
        Map<String, ClipCounts> clips = clipsByMatch(faceitPlayerId, matchIds);
        List<PlayerMatchResponse> faceitItems = page.stream()
                .map(line -> {
                    String id = line.matchId();
                    return response(line, stored.get(id), highlights.getOrDefault(id, List.of()),
                            clips.getOrDefault(id, NO_CLIPS));
                })
                .toList();
        List<PlayerMatchResponse> matchmakingItems = matchmakingResponses(faceitPlayerId, matchmaking, highlights,
                clips);
        return new PlayerMatchListResponse(merge(faceitItems, matchmakingItems), history.offset(), history.limit());
    }

    /**
     * Fills in what the database does not know of the FACEIT lines of a page of {@link #matches}: the map, and the
     * player's kills, deaths, assists and ADR, from FACEIT's statistics of the player's matches, joined by match id.
     * The database's own values stay wherever it has them (an analyzed demo is the truth); FACEIT's only fill the gaps.
     * FACEIT is asked once for the page, and only when one of its FACEIT lines has no map or no kills, deaths or
     * assists; a matchmaking row is never looked up there. A failure of that read is not the page's: it is logged and
     * the rows stay as the database left them.
     *
     * <p>Runs with no transaction open, after {@link #matches}, so that no connection is held while FACEIT is waited
     * for. FACEIT lists the statistics newest first as the history does, but without the matches it keeps none for
     * (a cancelled one), so a match sits at or before its place in the history: the window looked at starts
     * {@value #STATS_MARGIN} places before the page and reaches as far past its end, and is read in whole blocks of
     * {@value #STATS_BLOCK} (see {@link #STATS_BLOCK}).
     *
     * @param faceitPlayerId the FACEIT player id the page was read for
     * @param list what {@link #matches} answered
     */
    public PlayerMatchListResponse withFaceitStats(String faceitPlayerId, PlayerMatchListResponse list) {
        if (PlayerService.isSteamPlayerId(faceitPlayerId)
                || list.items().stream().noneMatch(PlayerOverviewService::lacksStoredFacts)) {
            return list;
        }
        int firstBlock = Math.max(0, list.offset() - STATS_MARGIN) / STATS_BLOCK;
        int lastBlock = (list.offset() + list.limit() + STATS_MARGIN - 1) / STATS_BLOCK;
        Map<String, FaceitPlayerMatchStats.Match> byMatch = new HashMap<>();
        try {
            for (int block = firstBlock; block <= lastBlock; block++) {
                faceit.getPlayerMatchStats(faceitPlayerId, block * STATS_BLOCK, STATS_BLOCK).matches()
                        .forEach(match -> byMatch.putIfAbsent(match.matchId(), match));
            }
        } catch (RuntimeException e) {
            log.warn("FACEIT's statistics of the player's matches could not be read, the list shows what the database"
                    + " knows: {}", e.getClass().getName());
            if (byMatch.isEmpty()) {
                return list;
            }
        }
        List<PlayerMatchResponse> items = list.items().stream()
                .map(item -> withFaceitFacts(item, byMatch.get(item.matchId())))
                .toList();
        return new PlayerMatchListResponse(items, list.offset(), list.limit());
    }

    /** A FACEIT line the database knows no map or no kills, deaths or assists of. */
    private static boolean lacksStoredFacts(PlayerMatchResponse item) {
        return isFaceitLine(item)
                && (item.mapName() == null || item.kills() == null || item.deaths() == null || item.assists() == null);
    }

    private static boolean isFaceitLine(PlayerMatchResponse item) {
        return item.source() == MatchSource.FACEIT && !MatchSource.isMatchmaking(item.matchId());
    }

    /** The row with FACEIT's values where the database has none; a row FACEIT listed nothing for stays as it is. */
    private static PlayerMatchResponse withFaceitFacts(PlayerMatchResponse item, FaceitPlayerMatchStats.Match stats) {
        if (stats == null || !isFaceitLine(item)) {
            return item;
        }
        Double faceitAdr = stats.adr() == null ? null : adr(BigDecimal.valueOf(stats.adr()));
        return new PlayerMatchResponse(item.matchId(), orElse(item.mapName(), stats.map()), item.startedAt(),
                item.finishedAt(), item.result(), item.score(), orElse(item.kills(), stats.kills()),
                orElse(item.deaths(), stats.deaths()), orElse(item.assists(), stats.assists()),
                orElse(item.adr(), faceitAdr), item.demoStatus(), item.highlights(), item.clips(), item.source());
    }

    private static <T> T orElse(T stored, T faceitValue) {
        return stored != null ? stored : faceitValue;
    }

    /**
     * The list of matches of a player asked for as {@code steam:<SteamID>}, wholly from the database: his matchmaking
     * matches, newest first, a page of {@code limit} from {@code offset}. A player the database does not know has an
     * empty list.
     *
     * @param rowPlayerId the {@code players.faceit_id} of the row that stands for the SteamID
     *        ({@link PlayerService#resolveSteamPlayerId}): the placeholder {@code steam:<SteamID>}, or the FACEIT player
     *        that carries the SteamID
     * @param steamId the SteamID, so that the matches a user with it brought in are his whatever the row
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PlayerMatchListResponse matchmakingMatches(String rowPlayerId, String steamId, int offset, int limit) {
        List<MatchmakingRow> rows = matchmakingRows(rowPlayerId, steamId, null, null, offset, limit);
        if (rows.isEmpty()) {
            return new PlayerMatchListResponse(List.of(), offset, limit);
        }
        List<String> matchIds = rows.stream().map(MatchmakingRow::matchId).toList();
        Map<String, List<HighlightCount>> highlights = highlightsByMatch(rowPlayerId, matchIds);
        Map<String, ClipCounts> clips = clipsByMatch(rowPlayerId, matchIds);
        return new PlayerMatchListResponse(matchmakingResponses(rowPlayerId, rows, highlights, clips), offset, limit);
    }

    /**
     * The lines of a page of FACEIT history that are not older than {@code oldest}. When a full page of matchmaking
     * matches fills the answer, the FACEIT lines older than its last one wait for the next request: they belong after
     * matchmaking matches this answer does not hold yet. The next request asks FACEIT from the number of FACEIT lines
     * received ({@code offset} counts FACEIT lines only), so they come again then. A line without a start stays.
     */
    private static List<MatchSummary> linesNotOlderThan(List<MatchSummary> page, Instant oldest) {
        if (oldest == null) {
            return page;
        }
        return page.stream()
                .filter(line -> line.startedAt() == null || !line.startedAt().isBefore(oldest))
                .toList();
    }

    /**
     * The stretch of time of a page of FACEIT history in which the person's matchmaking matches are shown with it:
     * below {@code before} (exclusive; now for the first page) and down to the start of the page's last line
     * (inclusive). A page shorter than its limit is the last one: it has no lower end, and takes the older matchmaking
     * matches a page at a time (see {@link #matches}). A later
     * page asked without {@code before} has no known upper end, and shows none, so that no match is listed twice.
     */
    private static Optional<Range> matchmakingRange(MatchHistoryResponse history, Instant before) {
        if (before == null && history.offset() > 0) {
            return Optional.empty();
        }
        List<MatchSummary> page = history.items();
        boolean lastPage = page.size() < history.limit();
        Instant from = lastPage || page.isEmpty() ? null : page.get(page.size() - 1).startedAt();
        return Optional.of(new Range(from, before));
    }

    /**
     * Reads the person's matchmaking matches: between {@code from} (inclusive) and {@code to} (exclusive) when they are
     * given, a page when {@code limit} is.
     *
     * @param ownSteamId the SteamID of a {@code steam:} player, so that the matches a user with it brought in are his
     *        before any of their demos is parsed; empty for a FACEIT player
     */
    private List<MatchmakingRow> matchmakingRows(String playerId, String ownSteamId, Instant from, Instant to,
                                                 Integer offset, Integer limit) {
        StringBuilder sql = new StringBuilder(MATCHMAKING_ROWS_SQL);
        if (from != null) {
            sql.append(" AND coalesce(m.started_at, d.created_at) >= :from");
        }
        if (to != null) {
            sql.append(" AND coalesce(m.started_at, d.created_at) < :to");
        }
        sql.append(MATCHMAKING_ORDER);
        if (limit != null) {
            sql.append(" LIMIT :limit OFFSET :offset");
        }
        JdbcClient.StatementSpec statement = jdbc.sql(sql.toString())
                .param("playerId", playerId)
                .param("ownSteamId", ownSteamId);
        if (from != null) {
            statement = statement.param("from", OffsetDateTime.ofInstant(from, ZoneOffset.UTC));
        }
        if (to != null) {
            statement = statement.param("to", OffsetDateTime.ofInstant(to, ZoneOffset.UTC));
        }
        if (limit != null) {
            statement = statement.param("limit", limit).param("offset", offset);
        }
        return statement.query((rs, rowNumber) -> new MatchmakingRow(rs.getLong("id"),
                        rs.getString("faceit_match_id"), rs.getString("map_name"),
                        instant(rs.getObject("listed_at", OffsetDateTime.class)),
                        instant(rs.getObject("finished_at", OffsetDateTime.class)),
                        rs.getObject("kills", Integer.class), rs.getObject("deaths", Integer.class),
                        rs.getObject("assists", Integer.class), adr(rs.getBigDecimal("adr")),
                        rs.getString("demo_status")))
                .list();
    }

    /**
     * The rows of matchmaking matches as the list answers them, with the score and the player's result from the demo
     * ({@link DemoScoreboard}).
     */
    private List<PlayerMatchResponse> matchmakingResponses(String playerId, List<MatchmakingRow> rows,
                                                           Map<String, List<HighlightCount>> highlights,
                                                           Map<String, ClipCounts> clips) {
        if (rows.isEmpty()) {
            return List.of();
        }
        List<Long> rowIds = rows.stream().map(MatchmakingRow::id).toList();
        Map<Long, DemoScoreboard.Score> scores = scoreboard.scores(rowIds);
        Map<Long, List<DemoScoreboard.TeamMember>> members = scoreboard.factions(rowIds);
        Long personRowId = jdbc.sql(PERSON_ROW_SQL).param("playerId", playerId).query(Long.class).optional()
                .orElse(null);
        List<PlayerMatchResponse> items = new ArrayList<>();
        for (MatchmakingRow row : rows) {
            DemoScoreboard.Score score = scores.get(row.id());
            String faction = personRowId == null ? null : members.getOrDefault(row.id(), List.of()).stream()
                    .filter(member -> member.playerRowId() == personRowId)
                    .map(DemoScoreboard.TeamMember::factionId)
                    .findFirst().orElse(null);
            String winner = score == null ? null : score.winner();
            MatchResult result = faction == null || winner == null ? MatchResult.UNKNOWN
                    : faction.equals(winner) ? MatchResult.WIN : MatchResult.LOSS;
            items.add(new PlayerMatchResponse(row.matchId(), row.mapName(), row.listedAt(), row.finishedAt(), result,
                    score == null ? Map.of() : score.byFaction(), row.kills(), row.deaths(), row.assists(), row.adr(),
                    row.demoStatus(), highlights.getOrDefault(row.matchId(), List.of()),
                    clips.getOrDefault(row.matchId(), NO_CLIPS), MatchSource.MATCHMAKING));
        }
        return items;
    }

    /**
     * Both lists newest first, merged by start: a FACEIT line keeps its place in the history, and a matchmaking match
     * goes before the first line that started earlier. A row without a start goes last.
     */
    private static List<PlayerMatchResponse> merge(List<PlayerMatchResponse> faceit,
                                                   List<PlayerMatchResponse> matchmaking) {
        if (matchmaking.isEmpty()) {
            return faceit;
        }
        List<PlayerMatchResponse> merged = new ArrayList<>(faceit.size() + matchmaking.size());
        int i = 0;
        int j = 0;
        while (i < faceit.size() && j < matchmaking.size()) {
            Instant left = faceit.get(i).startedAt();
            Instant right = matchmaking.get(j).startedAt();
            boolean matchmakingFirst = right != null && (left == null || right.isAfter(left));
            merged.add(matchmakingFirst ? matchmaking.get(j++) : faceit.get(i++));
        }
        merged.addAll(faceit.subList(i, faceit.size()));
        merged.addAll(matchmaking.subList(j, matchmaking.size()));
        return merged;
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
                known.demoStatus(), highlights, clips, MatchSource.FACEIT);
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }

    /** A stretch of time; either end may be open ({@code null}). */
    private record Range(Instant from, Instant to) {
    }

    /** What the matchmaking statement reads of one match; the numbers are null without a row of the player's. */
    private record MatchmakingRow(long id, String matchId, String mapName, Instant listedAt, Instant finishedAt,
                                  Integer kills, Integer deaths, Integer assists, Double adr, String demoStatus) {
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
