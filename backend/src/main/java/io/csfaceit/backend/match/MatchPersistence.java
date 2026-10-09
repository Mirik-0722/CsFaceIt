package io.csfaceit.backend.match;

import io.csfaceit.backend.match.dto.MatchStatsResponse;
import io.csfaceit.backend.match.dto.PlayerStatsResponse;
import io.csfaceit.backend.match.dto.TeamStatsResponse;
import io.csfaceit.backend.player.Player;
import io.csfaceit.backend.player.PlayerService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The database writes behind the match endpoints. It is a bean of its own so that the transaction proxy applies:
 * {@link MatchService} loads from FACEIT with no transaction open and only then calls in here, so a database
 * connection is never held while waiting for FACEIT.
 *
 * <p>Each method is one atomic unit of find-or-insert writes. When a concurrent request inserts the same row
 * first, PostgreSQL fails the insert with a unique violation, which aborts the whole transaction and surfaces as a
 * {@link org.springframework.dao.DataIntegrityViolationException}; nothing is recovered in here. The caller repeats
 * the whole method, and the repeat finds the other request's rows.
 */
@Component
public class MatchPersistence {

    private final MatchRepository matches;
    private final PlayerMatchStatsRepository playerMatchStats;
    private final PlayerService players;

    public MatchPersistence(MatchRepository matches, PlayerMatchStatsRepository playerMatchStats,
                            PlayerService players) {
        this.matches = matches;
        this.playerMatchStats = playerMatchStats;
        this.players = players;
    }

    /** Creates the {@code matches} row or updates its map and start/finish times. */
    @Transactional
    public void storeMatch(String matchId, String mapName, Instant startedAt, Instant finishedAt) {
        Match match = matches.findByFaceitMatchId(matchId).orElse(null);
        if (match == null) {
            matches.save(new Match(matchId, mapName, startedAt, finishedAt));
            return;
        }
        match.setMapName(mapName);
        match.setStartedAt(startedAt);
        match.setFinishedAt(finishedAt);
        matches.save(match);
    }

    /**
     * Writes one {@code player_match_stats} row per player of an already stored match, creating the players that
     * are not stored yet. The elo and level of a known player stay as they are; kast and rating are not set.
     */
    @Transactional
    public void storeStats(String matchId, MatchStatsResponse stats) {
        Match match = matches.findByFaceitMatchId(matchId)
                .orElseThrow(() -> new IllegalStateException("Match " + matchId + " is not stored"));
        for (TeamStatsResponse team : stats.teams()) {
            for (PlayerStatsResponse playerStats : team.players()) {
                storePlayerStats(match, playerStats);
            }
        }
    }

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
}
