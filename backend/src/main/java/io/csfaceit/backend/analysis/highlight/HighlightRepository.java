package io.csfaceit.backend.analysis.highlight;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface HighlightRepository extends JpaRepository<Highlight, Long> {

    /**
     * Deletes every highlight of the match, in one statement, so that an analysis can write its own set in their place.
     * A bulk delete: it flushes what is pending first, but entities already loaded in the persistence context are not
     * removed from it, so call it before loading or saving any highlight of the match.
     *
     * @return the number of highlights deleted
     */
    @Modifying(flushAutomatically = true)
    @Query("delete from Highlight h where h.match.id = :matchId")
    int deleteByMatchId(@Param("matchId") Long matchId);
}
