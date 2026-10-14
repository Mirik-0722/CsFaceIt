package io.csfaceit.backend.match;

import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.FaceitNotFoundException;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchStats;
import io.csfaceit.backend.faceit.dto.FaceitMatchTeam;
import io.csfaceit.backend.faceit.dto.FaceitRosterPlayer;
import io.csfaceit.backend.faceit.dto.FaceitStatsPlayer;
import io.csfaceit.backend.faceit.dto.FaceitStatsRound;
import io.csfaceit.backend.faceit.dto.FaceitStatsTeam;
import io.csfaceit.backend.match.dto.MatchResponse;
import io.csfaceit.backend.match.dto.MatchStatsResponse;
import io.csfaceit.backend.match.dto.PlayerStatsResponse;
import io.csfaceit.backend.match.dto.RosterPlayerResponse;
import io.csfaceit.backend.match.dto.TeamResponse;
import io.csfaceit.backend.match.dto.TeamStatsResponse;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

@Service
public class MatchService {

    private static final String MATCH_NOT_FOUND = "MATCH_NOT_FOUND";

    private static final String ROUND_MAP = "Map";
    private static final String ROUND_ROUNDS = "Rounds";
    private static final String TEAM_NAME = "Team";
    private static final String TEAM_WIN = "Team Win";
    private static final String TEAM_FINAL_SCORE = "Final Score";
    private static final String KILLS = "Kills";
    private static final String DEATHS = "Deaths";
    private static final String ASSISTS = "Assists";
    private static final String HEADSHOTS = "Headshots";
    private static final String KD_RATIO = "K/D Ratio";
    private static final String KR_RATIO = "K/R Ratio";
    private static final String ADR = "ADR";

    /**
     * Largest ADR/ratio value that still fits {@code NUMERIC(6,2)} after rounding to two places: 9999.995 would
     * round up to 10000.00.
     */
    private static final double DECIMAL_STAT_LIMIT = 9999.995;

    private static final Logger log = LoggerFactory.getLogger(MatchService.class);

    private final FaceitGateway faceit;
    private final MatchRepository matches;
    private final MatchPersistence persistence;

    public MatchService(FaceitGateway faceit, MatchRepository matches, MatchPersistence persistence) {
        this.faceit = faceit;
        this.matches = matches;
        this.persistence = persistence;
    }

    /**
     * Loads the match from FACEIT, then stores its map and start/finish times in the {@code matches} table. The
     * FACEIT call runs with no transaction open; only the write is transactional (see {@link MatchPersistence}).
     */
    public MatchResponse getMatch(String matchId) {
        refuseMatchmaking(matchId);
        FaceitMatch found = loadMatch(matchId);
        String mapName = mapName(found);
        Instant startedAt = instant(found.startedAt());
        Instant finishedAt = instant(found.finishedAt());
        persistWithRetry("match " + matchId, () -> persistence.storeMatch(matchId, mapName, startedAt, finishedAt));
        return toResponse(matchId, found, mapName, startedAt, finishedAt);
    }

    /**
     * Loads the match statistics from FACEIT and stores one {@code player_match_stats} row per player (storing the
     * match first when it is not stored yet; a stored match is not fetched again). Repeating the call updates the
     * same rows.
     */
    public MatchStatsResponse getStats(String matchId) {
        refuseMatchmaking(matchId);
        if (matches.findByFaceitMatchId(matchId).isEmpty()) {
            getMatch(matchId);
        }
        MatchStatsResponse response = toStatsResponse(matchId, loadStats(matchId));
        persistWithRetry("stats of match " + matchId, () -> persistence.storeStats(matchId, response));
        return response;
    }

    /**
     * FACEIT knows nothing of a matchmaking match ({@code mm-<id>}), and must never be asked about one: such a match is
     * read from the database ({@link DemoScoreboard}). A caller that gets here with one has a bug, which this makes loud
     * before any FACEIT call instead of letting it reach FACEIT.
     */
    private static void refuseMatchmaking(String matchId) {
        if (MatchSource.isMatchmaking(matchId)) {
            throw new IllegalArgumentException("Match " + matchId + " is a matchmaking match, which FACEIT does not "
                    + "know; read it with DemoScoreboard");
        }
    }

    private FaceitMatch loadMatch(String matchId) {
        try {
            return faceit.getMatch(matchId);
        } catch (FaceitNotFoundException e) {
            throw new NotFoundException(MATCH_NOT_FOUND, "Match not found: " + matchId);
        }
    }

    private FaceitMatchStats loadStats(String matchId) {
        try {
            return faceit.getMatchStats(matchId);
        } catch (FaceitNotFoundException e) {
            throw new NotFoundException(MATCH_NOT_FOUND, "Match stats not found: " + matchId);
        }
    }

    /**
     * Runs one persistence step and, if it loses a first-access race, runs it once more. Two requests that meet an
     * unseen match or player both find nothing and both insert; PostgreSQL fails the loser's insert with a unique
     * violation (or, when two requests insert the same players in a different order, a deadlock), which aborts that
     * transaction. The repeat is a new transaction that finds what the winner committed. A second failure is real
     * and propagates.
     */
    private static void persistWithRetry(String what, Runnable persist) {
        try {
            persist.run();
        } catch (DataIntegrityViolationException | ConcurrencyFailureException e) {
            log.info("Lost a concurrent first-access write race for {} ({}), retrying once", what,
                    e.getClass().getSimpleName());
            persist.run();
        }
    }

    private static MatchResponse toResponse(String matchId, FaceitMatch match, String mapName, Instant startedAt,
                                            Instant finishedAt) {
        List<TeamResponse> teams = match.teams() == null ? List.of() : match.teams().entrySet().stream()
                .filter(entry -> entry.getValue() != null)
                .map(entry -> toTeamResponse(entry.getKey(), entry.getValue()))
                .toList();
        String demoUrl = match.demoUrl() == null || match.demoUrl().isEmpty() ? null : match.demoUrl().get(0);
        String winner = match.results() == null ? null : match.results().winner();
        return new MatchResponse(matchId, mapName, match.status(), startedAt, finishedAt, demoUrl, teams, winner,
                MatchSource.FACEIT);
    }

    private static TeamResponse toTeamResponse(String factionId, FaceitMatchTeam team) {
        List<RosterPlayerResponse> roster = team.roster() == null ? List.of() : team.roster().stream()
                .filter(Objects::nonNull)
                .map((FaceitRosterPlayer player) -> new RosterPlayerResponse(player.playerId(), player.nickname()))
                .toList();
        return new TeamResponse(factionId, team.name(), roster);
    }

    /** FACEIT reports one entry per played map; a match is a single map, so only the first one is used. */
    private static MatchStatsResponse toStatsResponse(String matchId, FaceitMatchStats stats) {
        if (stats.rounds() == null || stats.rounds().isEmpty() || stats.rounds().get(0) == null) {
            return new MatchStatsResponse(matchId, null, 0, List.of());
        }
        FaceitStatsRound round = stats.rounds().get(0);
        Map<String, String> roundStats = round.roundStats();
        List<TeamStatsResponse> teams = round.teams() == null ? List.of() : round.teams().stream()
                .filter(Objects::nonNull)
                .map(MatchService::toTeamStatsResponse)
                .toList();
        return new MatchStatsResponse(matchId, text(roundStats, ROUND_MAP), intStat(roundStats, ROUND_ROUNDS), teams);
    }

    private static TeamStatsResponse toTeamStatsResponse(FaceitStatsTeam team) {
        // A player entry without an id or nickname cannot be stored, so it is left out of the answer as well.
        List<PlayerStatsResponse> playerStats = team.players() == null ? List.of() : team.players().stream()
                .filter(player -> player != null && player.playerId() != null && player.nickname() != null)
                .map(MatchService::toPlayerStatsResponse)
                .toList();
        return new TeamStatsResponse(team.teamId(), text(team.teamStats(), TEAM_NAME),
                intStat(team.teamStats(), TEAM_FINAL_SCORE), intStat(team.teamStats(), TEAM_WIN) == 1, playerStats);
    }

    private static PlayerStatsResponse toPlayerStatsResponse(FaceitStatsPlayer player) {
        Map<String, String> stats = player.playerStats();
        return new PlayerStatsResponse(player.playerId(), player.nickname(), intStat(stats, KILLS),
                intStat(stats, DEATHS), intStat(stats, ASSISTS), intStat(stats, HEADSHOTS),
                doubleStat(stats, KD_RATIO), doubleStat(stats, KR_RATIO), doubleStat(stats, ADR));
    }

    /** The map that was picked in the veto, or {@code null} while there is no pick. */
    private static String mapName(FaceitMatch match) {
        if (match.voting() == null || match.voting().map() == null) {
            return null;
        }
        List<String> pick = match.voting().map().pick();
        return pick == null || pick.isEmpty() ? null : pick.get(0);
    }

    private static Instant instant(Long epochSeconds) {
        return epochSeconds == null ? null : Instant.ofEpochSecond(epochSeconds);
    }

    /** The trimmed value of a FACEIT statistic, or {@code null} when the map or the key is missing. */
    private static String text(Map<String, String> stats, String key) {
        String value = stats == null ? null : stats.get(key);
        return value == null ? null : value.trim();
    }

    /** FACEIT sends statistics as strings; a missing, empty or non-numeric value counts as 0. */
    static int intStat(Map<String, String> stats, String key) {
        String value = text(stats, key);
        if (value == null) {
            return 0;
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /**
     * Like {@link #intStat}; {@code NaN}, the infinities and values the {@code adr} column cannot hold (negative, or
     * 10000 and above) count as 0 too, so the response and the stored row always agree.
     */
    static double doubleStat(Map<String, String> stats, String key) {
        String value = text(stats, key);
        if (value == null) {
            return 0;
        }
        try {
            double parsed = Double.parseDouble(value);
            return Double.isFinite(parsed) && parsed >= 0 && parsed < DECIMAL_STAT_LIMIT ? parsed : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
