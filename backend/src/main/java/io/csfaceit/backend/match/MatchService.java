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
import io.csfaceit.backend.player.Player;
import io.csfaceit.backend.player.PlayerService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

    private final FaceitGateway faceit;
    private final MatchRepository matches;
    private final PlayerMatchStatsRepository playerMatchStats;
    private final PlayerService players;

    public MatchService(FaceitGateway faceit, MatchRepository matches, PlayerMatchStatsRepository playerMatchStats,
                        PlayerService players) {
        this.faceit = faceit;
        this.matches = matches;
        this.playerMatchStats = playerMatchStats;
        this.players = players;
    }

    /** Loads the match from FACEIT and stores its map and start/finish times in the {@code matches} table. */
    @Transactional
    public MatchResponse getMatch(String matchId) {
        FaceitMatch found = loadMatch(matchId);
        storeMatch(matchId, found);
        return toResponse(matchId, found);
    }

    /**
     * Loads the match statistics from FACEIT and stores one {@code player_match_stats} row per player (creating
     * the player and the match first when they are not stored yet). Repeating the call updates the same rows.
     */
    @Transactional
    public MatchStatsResponse getStats(String matchId) {
        Match match = matches.findByFaceitMatchId(matchId).orElse(null);
        if (match == null) {
            match = storeMatch(matchId, loadMatch(matchId));
        }
        MatchStatsResponse response = toStatsResponse(matchId, loadStats(matchId));
        for (TeamStatsResponse team : response.teams()) {
            for (PlayerStatsResponse stats : team.players()) {
                storePlayerStats(match, stats);
            }
        }
        return response;
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

    private Match storeMatch(String matchId, FaceitMatch found) {
        String mapName = mapName(found);
        Instant startedAt = instant(found.startedAt());
        Instant finishedAt = instant(found.finishedAt());

        Match match = matches.findByFaceitMatchId(matchId).orElse(null);
        if (match == null) {
            return matches.save(new Match(matchId, mapName, startedAt, finishedAt));
        }
        match.setMapName(mapName);
        match.setStartedAt(startedAt);
        match.setFinishedAt(finishedAt);
        return matches.save(match);
    }

    /** Creates or updates the player (elo and level stay as they are) and the player's row for this match. */
    private void storePlayerStats(Match match, PlayerStatsResponse stats) {
        Player player = players.ensurePlayer(stats.playerId(), stats.nickname());
        PlayerMatchStats row = playerMatchStats.findByPlayerIdAndMatchId(player.getId(), match.getId())
                .orElseGet(() -> new PlayerMatchStats(player, match));
        row.setKills(stats.kills());
        row.setDeaths(stats.deaths());
        row.setAssists(stats.assists());
        row.setHeadshots(stats.headshots());
        row.setAdr(BigDecimal.valueOf(stats.adr()).setScale(2, RoundingMode.HALF_UP));
        playerMatchStats.save(row);
    }

    private static MatchResponse toResponse(String matchId, FaceitMatch match) {
        List<TeamResponse> teams = match.teams() == null ? List.of() : match.teams().entrySet().stream()
                .filter(entry -> entry.getValue() != null)
                .map(entry -> toTeamResponse(entry.getKey(), entry.getValue()))
                .toList();
        String demoUrl = match.demoUrl() == null || match.demoUrl().isEmpty() ? null : match.demoUrl().get(0);
        String winner = match.results() == null ? null : match.results().winner();
        return new MatchResponse(matchId, mapName(match), match.status(), instant(match.startedAt()),
                instant(match.finishedAt()), demoUrl, teams, winner);
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

    /** Like {@link #intStat}; {@code NaN} and the infinities count as 0 too, as JSON cannot carry them. */
    static double doubleStat(Map<String, String> stats, String key) {
        String value = text(stats, key);
        if (value == null) {
            return 0;
        }
        try {
            double parsed = Double.parseDouble(value);
            return Double.isFinite(parsed) ? parsed : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
