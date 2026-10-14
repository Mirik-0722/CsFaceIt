package io.csfaceit.backend.match;

import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.match.dto.MatchResponse;
import io.csfaceit.backend.match.dto.MatchStatsResponse;
import io.csfaceit.backend.match.dto.PlayerStatsResponse;
import io.csfaceit.backend.match.dto.RosterPlayerResponse;
import io.csfaceit.backend.match.dto.TeamResponse;
import io.csfaceit.backend.match.dto.TeamStatsResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a match that exists from its demo alone ({@link MatchSource#MATCHMAKING}) is made of: everything FACEIT gives for
 * a FACEIT match is read here from the facts the parser wrote and the rows the analysis stored. FACEIT is never asked.
 *
 * <ul>
 *   <li>The teams are the sides of the first round the demo has: {@value #FACTION_CT_START} is the team that started on
 *       CT, {@value #FACTION_T_START} the one that started on T. A player who joined later belongs to the team whose
 *       side he played in the first round he appears in; the side of {@value #FACTION_CT_START} in a round is the side
 *       most of its first-round players had in it, which follows the swap at half time and in overtime. A demo
 *       recorded from after the start labels the teams by the first round it has.
 *   <li>The score is the rounds each team won ({@code rounds.winner_side} against the team's side in that round); the
 *       winner is the team with more, none on a draw.
 *   <li>The statistics are the analysis' rows of {@code player_match_stats} (those with {@code rounds_played}), grouped
 *       by the team of the player.
 * </ul>
 *
 * <p>All of it is read only while the match's demo is {@code ANALYZED}: the wrong-demo check runs between
 * {@code PARSED} and {@code ANALYZED}, and the facts of a demo that is not checked yet, or that failed as another game's
 * ({@code WRONG_MATCH} keeps the parser's rows), must not show strangers as the match's players. Until then the match
 * has no teams, no score and no statistics, like a FACEIT match before its analysis.
 *
 * <p>The team names are the placeholders {@value #NAME_CT_START} and {@value #NAME_T_START}: a matchmaking demo has no
 * team names of its own worth showing.
 */
@Component
public class DemoScoreboard {

    public static final String FACTION_CT_START = "faction1";
    public static final String FACTION_T_START = "faction2";
    public static final String NAME_CT_START = "CT";
    public static final String NAME_T_START = "T";

    /** A matchmaking match is known only once it has been played. */
    static final String STATUS_FINISHED = "FINISHED";

    private static final String MATCH_NOT_FOUND = "MATCH_NOT_FOUND";
    private static final int RATIO_SCALE = 2;

    /**
     * For each match of {@code :matchIds} whose demo is {@code ANALYZED} and each of its rounds, the side the team that
     * started on CT played: {@code first_round} is the first round of the rosters, {@code ct_start} its CT players, and
     * {@code faction1_side} the side most of them had in each round ({@code mode()}; a tie, which needs a team split in
     * two, takes the first in order). Every statement built on it reads only those matches.
     */
    private static final String FACTION1_SIDE_CTE = """
            WITH first_round AS (
                SELECT rp.match_id, min(rp.round_number) AS round_number
                FROM round_players rp
                JOIN demos d ON d.match_id = rp.match_id AND d.status = 'ANALYZED'
                WHERE rp.match_id IN (:matchIds)
                GROUP BY rp.match_id),
            ct_start AS (
                SELECT rp.match_id, rp.player_id
                FROM round_players rp
                JOIN first_round f ON f.match_id = rp.match_id AND f.round_number = rp.round_number
                WHERE rp.side = 'CT'),
            faction1_side AS (
                SELECT rp.match_id, rp.round_number, mode() WITHIN GROUP (ORDER BY rp.side) AS side
                FROM round_players rp
                JOIN ct_start c ON c.match_id = rp.match_id AND c.player_id = rp.player_id
                WHERE rp.match_id IN (:matchIds)
                GROUP BY rp.match_id, rp.round_number)
            """;

    private static final String SCORES_SQL = FACTION1_SIDE_CTE + """
            SELECT r.match_id,
                   count(*) FILTER (WHERE r.winner_side = s.side) AS faction1,
                   count(*) FILTER (WHERE r.winner_side <> s.side) AS faction2
            FROM rounds r
            JOIN faction1_side s ON s.match_id = r.match_id AND s.round_number = r.round_number
            WHERE r.match_id IN (:matchIds) AND r.winner_side IN ('CT', 'T')
            GROUP BY r.match_id""";

    /** Each player's team, from the first round he played in whose sides are known. */
    private static final String FACTIONS_SQL = FACTION1_SIDE_CTE + """
            SELECT DISTINCT ON (rp.match_id, rp.player_id)
                   rp.match_id, rp.player_id, p.faceit_id, p.nickname, rp.side = s.side AS started_ct
            FROM round_players rp
            JOIN faction1_side s ON s.match_id = rp.match_id AND s.round_number = rp.round_number
            JOIN players p ON p.id = rp.player_id
            WHERE rp.match_id IN (:matchIds)
            ORDER BY rp.match_id, rp.player_id, rp.round_number""";

    private static final String MATCH_SQL = """
            SELECT m.id, m.faceit_match_id, m.map_name, m.started_at, m.finished_at, m.owner_user_id,
                   d.status AS demo_status
            FROM matches m
            LEFT JOIN demos d ON d.match_id = m.id
            WHERE m.faceit_match_id = :matchId""";

    private static final String ROUNDS_SQL = "SELECT count(*) FROM rounds WHERE match_id = :matchRowId";

    private static final String STATS_SQL = """
            SELECT s.player_id, p.faceit_id, p.nickname, s.kills, s.deaths, s.assists, s.headshots, s.adr
            FROM player_match_stats s
            JOIN players p ON p.id = s.player_id
            JOIN demos d ON d.match_id = s.match_id AND d.status = 'ANALYZED'
            WHERE s.match_id = :matchRowId AND s.rounds_played IS NOT NULL""";

    /**
     * The SteamIDs of the players of the match's {@code ANALYZED} demo: the column, else the one in a placeholder id
     * {@code steam:<SteamID>} (as {@code RosterCheck} reads them).
     */
    private static final String STEAM_IDS_SQL = """
            SELECT DISTINCT coalesce(p.steam_id,
                                     CASE WHEN p.faceit_id ~ '^steam:[0-9]{17}$' THEN substr(p.faceit_id, 7) END)
            FROM round_players rp
            JOIN players p ON p.id = rp.player_id
            JOIN demos d ON d.match_id = rp.match_id AND d.status = 'ANALYZED'
            WHERE rp.match_id = :matchRowId""";

    /** The rounds each team won. */
    public record Score(int faction1, int faction2) {

        /** The team that won more rounds; {@code null} on a draw. */
        public String winner() {
            if (faction1 == faction2) {
                return null;
            }
            return faction1 > faction2 ? FACTION_CT_START : FACTION_T_START;
        }

        /** As a FACEIT score is keyed: by faction. */
        public Map<String, Integer> byFaction() {
            return Map.of(FACTION_CT_START, faction1, FACTION_T_START, faction2);
        }
    }

    /** A player of a matchmaking match and the team he is in. */
    public record TeamMember(long playerRowId, String playerId, String nickname, String factionId) {
    }

    /**
     * The stored row of a match, with the status of its demo ({@code null} without one).
     *
     * @param ownerUserId the user who brought the matchmaking match in; {@code null} without one
     */
    public record StoredMatch(long id, String matchId, String mapName, Instant startedAt, Instant finishedAt,
                              Long ownerUserId, String demoStatus) {

        /**
         * Whether the demo's players can be trusted: the demo is ANALYZED, so it has passed the wrong-demo check, which
         * runs between PARSED and ANALYZED.
         */
        public boolean analyzed() {
            return "ANALYZED".equals(demoStatus);
        }
    }

    private final JdbcClient jdbc;

    public DemoScoreboard(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** The stored match with this public id, whatever its source. */
    @Transactional(readOnly = true)
    public Optional<StoredMatch> find(String matchId) {
        return jdbc.sql(MATCH_SQL).param("matchId", matchId)
                .query((rs, rowNumber) -> new StoredMatch(rs.getLong("id"), rs.getString("faceit_match_id"),
                        rs.getString("map_name"), instant(rs.getObject("started_at", OffsetDateTime.class)),
                        instant(rs.getObject("finished_at", OffsetDateTime.class)),
                        rs.getObject("owner_user_id", Long.class), rs.getString("demo_status")))
                .optional();
    }

    /**
     * The details of a matchmaking match, read on one snapshot.
     *
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: the database has no match with this id
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public MatchResponse match(String matchId) {
        StoredMatch stored = require(matchId);
        Score score = scores(List.of(stored.id())).get(stored.id());
        List<TeamMember> members = factions(List.of(stored.id())).getOrDefault(stored.id(), List.of());
        List<TeamResponse> teams = members.isEmpty() ? List.of() : List.of(
                team(FACTION_CT_START, NAME_CT_START, members),
                team(FACTION_T_START, NAME_T_START, members));
        return new MatchResponse(stored.matchId(), stored.mapName(), STATUS_FINISHED, stored.startedAt(),
                stored.finishedAt(), null, teams, score == null ? null : score.winner(), MatchSource.MATCHMAKING);
    }

    /**
     * The statistics of a matchmaking match by team, read on one snapshot. Until the demo is analyzed there are no
     * teams.
     *
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: the database has no match with this id
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public MatchStatsResponse stats(String matchId) {
        StoredMatch stored = require(matchId);
        List<TeamMember> members = factions(List.of(stored.id())).getOrDefault(stored.id(), List.of());
        if (members.isEmpty()) {
            return new MatchStatsResponse(stored.matchId(), stored.mapName(), 0, List.of());
        }
        int rounds = jdbc.sql(ROUNDS_SQL).param("matchRowId", stored.id()).query(Integer.class).single();
        Score score = scores(List.of(stored.id())).getOrDefault(stored.id(), new Score(0, 0));
        Map<Long, String> factionOf = new HashMap<>();
        members.forEach(member -> factionOf.put(member.playerRowId(), member.factionId()));
        Map<String, List<PlayerStatsResponse>> byFaction = new HashMap<>();
        jdbc.sql(STATS_SQL).param("matchRowId", stored.id()).query(rs -> {
            String faction = factionOf.get(rs.getLong("player_id"));
            if (faction == null) {
                // A player with statistics is in the rosters the teams come from; a row of anyone else is not shown.
                return;
            }
            int kills = rs.getInt("kills");
            int deaths = rs.getInt("deaths");
            BigDecimal adr = rs.getBigDecimal("adr");
            byFaction.computeIfAbsent(faction, key -> new ArrayList<>()).add(new PlayerStatsResponse(
                    rs.getString("faceit_id"), rs.getString("nickname"), kills, deaths, rs.getInt("assists"),
                    rs.getInt("headshots"), ratio(kills, Math.max(deaths, 1)), ratio(kills, Math.max(rounds, 1)),
                    adr == null ? 0 : adr.doubleValue()));
        });
        String winner = score.winner();
        List<TeamStatsResponse> teams = List.of(
                teamStats(FACTION_CT_START, NAME_CT_START, score.faction1(), winner, byFaction),
                teamStats(FACTION_T_START, NAME_T_START, score.faction2(), winner, byFaction));
        return new MatchStatsResponse(stored.matchId(), stored.mapName(), rounds, teams);
    }

    /**
     * The score of each match of {@code matchRowIds} whose demo is {@code ANALYZED}; a match without such a demo or
     * without rounds is absent.
     */
    public Map<Long, Score> scores(Collection<Long> matchRowIds) {
        Map<Long, Score> scores = new HashMap<>();
        if (matchRowIds.isEmpty()) {
            return scores;
        }
        jdbc.sql(SCORES_SQL).param("matchIds", matchRowIds).query(rs -> {
            scores.put(rs.getLong("match_id"), new Score(rs.getInt("faction1"), rs.getInt("faction2")));
        });
        return scores;
    }

    /** The players of each match of {@code matchRowIds} with their team; a match without rosters is absent. */
    public Map<Long, List<TeamMember>> factions(Collection<Long> matchRowIds) {
        Map<Long, List<TeamMember>> byMatch = new HashMap<>();
        if (matchRowIds.isEmpty()) {
            return byMatch;
        }
        jdbc.sql(FACTIONS_SQL).param("matchIds", matchRowIds).query(rs -> {
            byMatch.computeIfAbsent(rs.getLong("match_id"), id -> new ArrayList<>()).add(new TeamMember(
                    rs.getLong("player_id"), rs.getString("faceit_id"), rs.getString("nickname"),
                    rs.getBoolean("started_ct") ? FACTION_CT_START : FACTION_T_START));
        });
        return byMatch;
    }

    /** The SteamIDs of the players of the match's demo; empty until the demo is ANALYZED. */
    public Set<String> steamIds(long matchRowId) {
        return jdbc.sql(STEAM_IDS_SQL).param("matchRowId", matchRowId).query(String.class).list().stream()
                .filter(Objects::nonNull)
                .collect(LinkedHashSet::new, Set::add, Set::addAll);
    }

    private StoredMatch require(String matchId) {
        return find(matchId).orElseThrow(() -> new NotFoundException(MATCH_NOT_FOUND, "Match not found: " + matchId));
    }

    private static TeamResponse team(String factionId, String name, List<TeamMember> members) {
        List<RosterPlayerResponse> players = members.stream()
                .filter(member -> member.factionId().equals(factionId))
                .sorted(Comparator.comparing(TeamMember::nickname, String.CASE_INSENSITIVE_ORDER))
                .map(member -> new RosterPlayerResponse(member.playerId(), member.nickname()))
                .toList();
        return new TeamResponse(factionId, name, players);
    }

    private static TeamStatsResponse teamStats(String factionId, String name, int score, String winner,
                                               Map<String, List<PlayerStatsResponse>> byFaction) {
        List<PlayerStatsResponse> players = byFaction.getOrDefault(factionId, List.of()).stream()
                .sorted(Comparator.comparingInt(PlayerStatsResponse::kills).reversed()
                        .thenComparing(PlayerStatsResponse::nickname, String.CASE_INSENSITIVE_ORDER))
                .toList();
        return new TeamStatsResponse(factionId, name, score, factionId.equals(winner), players);
    }

    private static double ratio(int dividend, int divisor) {
        return BigDecimal.valueOf(dividend)
                .divide(BigDecimal.valueOf(divisor), RATIO_SCALE, RoundingMode.HALF_UP)
                .doubleValue();
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }
}
