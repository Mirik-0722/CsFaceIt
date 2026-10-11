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

    /**
     * Sets {@code error} on the demo and nothing else: the status stays, and so does {@code updated_at}. A bulk update,
     * so the entity lifecycle does not run. Noting that an analysis failed is no change of the demo's place in the
     * pipeline, and {@code updated_at} is the version an analysis compares to see whether the demo was uploaded or
     * parsed again; a bump here would make an analysis that claimed the demo just before look outdated and drop its
     * result. The caller holds the row lock and has checked the status.
     */
    @Modifying
    @Query("update Demo d set d.error = :error where d.id = :id")
    int noteError(@Param("id") Long id, @Param("error") String error);
}
