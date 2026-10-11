package io.csfaceit.backend.match;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PlayerMatchStatsRepository extends JpaRepository<PlayerMatchStats, Long> {

    Optional<PlayerMatchStats> findByPlayerIdAndMatchId(Long playerId, Long matchId);

    /**
     * Forgets what an earlier analysis of the demo of the match put in its rows: {@code rounds_played}, {@code kast}
     * and the entry, trade and clutch counts become NULL, so that a player the next analysis does not mention (the
     * roster of a new parse differs) does not look analyzed. A bulk update: it flushes what is pending first, but
     * entities already loaded in the persistence context are not refreshed, so call it before loading any row of
     * the match.
     */
    @Modifying(flushAutomatically = true)
    @Query("""
            update PlayerMatchStats s
            set s.roundsPlayed = null, s.kast = null, s.entryKills = null, s.tradeKills = null,
                s.clutchAttempts = null, s.clutchWins = null
            where s.match.id = :matchId""")
    int clearAnalysis(@Param("matchId") Long matchId);
}
