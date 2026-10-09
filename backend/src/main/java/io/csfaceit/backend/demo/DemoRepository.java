package io.csfaceit.backend.demo;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
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

    /** Like {@link #findById} but locks the row until the surrounding transaction ends. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from Demo d where d.id = :id")
    Optional<Demo> findByIdForUpdate(@Param("id") Long id);

    /**
     * Sets {@code storage_key} to NULL on the demos that point at {@code storageKey}. A bulk update, so the entity
     * lifecycle does not run and {@code updated_at} keeps its value.
     */
    @Modifying
    @Query("update Demo d set d.storageKey = null where d.storageKey = :storageKey")
    int clearStorageKey(@Param("storageKey") String storageKey);
}
