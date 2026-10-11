package io.csfaceit.backend.match;

import java.util.Collection;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PlayerMatchStatsRepository extends JpaRepository<PlayerMatchStats, Long> {

    Optional<PlayerMatchStats> findByPlayerIdAndMatchId(Long playerId, Long matchId);

    /**
     * Deletes the rows of the match that an analysis owns ({@code rounds_played} is set) whose player is not one of
     * {@code playerIds}: the player is no longer in the demo (the roster of a new parse differs, or another demo was
     * uploaded to the match), and the row would keep the figures of the old analysis for good. With no ids every such
     * row of the match goes. Rows that only FACEIT's numbers fill ({@code rounds_played} is NULL) stay. A bulk delete:
     * it flushes what is pending first, but entities already loaded in the persistence context are not removed from
     * it, so call it before loading any row of the match.
     *
     * @return the number of rows deleted
     */
    @Modifying(flushAutomatically = true)
    @Query("""
            delete from PlayerMatchStats s
            where s.match.id = :matchId and s.roundsPlayed is not null and s.player.id not in :playerIds""")
    int deleteAnalyzedExcept(@Param("matchId") Long matchId, @Param("playerIds") Collection<Long> playerIds);

    /**
     * Forgets what an earlier analysis of the demo of the match put in its rows: {@code rounds_played}, {@code kast}
     * and the entry, trade and clutch counts become NULL, so that a row does not look analyzed from facts it was not
     * written from. A bulk update: it flushes what is pending first, but entities already loaded in the persistence
     * context are not refreshed, so call it before loading any row of the match.
     */
    @Modifying(flushAutomatically = true)
    @Query("""
            update PlayerMatchStats s
            set s.roundsPlayed = null, s.kast = null, s.entryKills = null, s.tradeKills = null,
                s.clutchAttempts = null, s.clutchWins = null
            where s.match.id = :matchId""")
    int clearAnalysis(@Param("matchId") Long matchId);
}
