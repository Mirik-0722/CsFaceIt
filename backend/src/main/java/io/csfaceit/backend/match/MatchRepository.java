package io.csfaceit.backend.match;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface MatchRepository extends JpaRepository<Match, Long> {

    Optional<Match> findByFaceitMatchId(String faceitMatchId);

    /**
     * Forgets the map of the match if it is a matchmaking match, whose only map is the one the parser wrote from its
     * demo; a FACEIT match keeps the map FACEIT gave it. A single statement, so that no other column of the row is
     * written.
     *
     * @return 1 when the map was forgotten, 0 for a FACEIT match or no such row
     */
    @Modifying
    @Query(value = "UPDATE matches SET map_name = NULL WHERE id = :id AND source = 'MATCHMAKING'", nativeQuery = true)
    int clearMatchmakingMap(@Param("id") long id);
}
