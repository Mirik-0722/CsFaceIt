package io.csfaceit.backend.demo;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DemoRepository extends JpaRepository<Demo, Long> {

    Optional<Demo> findByMatchId(Long matchId);

    Optional<Demo> findByMatchFaceitMatchId(String faceitMatchId);

    /**
     * Like {@link #findByMatchId} but locks the row until the surrounding transaction ends, so that concurrent
     * requests for the same demo take their decisions one after the other.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from Demo d where d.match.id = :matchId")
    Optional<Demo> findByMatchIdForUpdate(@Param("matchId") Long matchId);
}
