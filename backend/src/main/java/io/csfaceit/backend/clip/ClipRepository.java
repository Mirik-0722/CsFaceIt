package io.csfaceit.backend.clip;

import io.csfaceit.backend.analysis.highlight.HighlightType;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ClipRepository extends JpaRepository<Clip, Long> {

    /**
     * The id of the clip of a highlight at a quality that is not {@code FAILED}: the one a new request is answered with
     * instead of another recording. At most one row matches, {@code uq_clips_highlight} is a unique index over exactly
     * these columns. A {@code FAILED} clip is not looked at, so asking for the clip again starts a new one.
     */
    @Query("""
            select c.id from Clip c
            where c.kind = io.csfaceit.backend.clip.ClipKind.HIGHLIGHT
              and c.match.id = :matchId and c.player.id = :playerId and c.highlightType = :type
              and c.roundNumber = :roundNumber and c.tickStart = :tickStart and c.quality = :quality
              and c.status <> io.csfaceit.backend.clip.ClipStatus.FAILED""")
    Optional<Long> findLiveHighlightClipId(@Param("matchId") long matchId, @Param("playerId") long playerId,
                                           @Param("type") HighlightType type, @Param("roundNumber") int roundNumber,
                                           @Param("tickStart") int tickStart, @Param("quality") ClipQuality quality);

    long countByStatus(ClipStatus status);

    /**
     * The oldest clip that is {@code QUEUED} at one of the given qualities ({@code (created_at, id)} is the order of
     * the queue), read with a row lock that lasts until the surrounding transaction ends. A row that another
     * transaction holds locked is skipped, not waited for, so of several recorders asking at once each gets a clip of
     * its own and none waits for another; and a row whose status that other transaction changed and committed since
     * is looked at again by PostgreSQL and is no longer {@code QUEUED}, so it is not given out twice either. The
     * caller has to be in a transaction: the lock is gone when the statement is not in one.
     *
     * @param status the status of a clip that waits for a recorder, {@code QUEUED}
     * @param qualityLabels the labels of the qualities wanted ({@code clips.quality} holds the label), not empty
     */
    @Query(value = """
            SELECT c.* FROM clips c
            WHERE c.status = :status AND c.quality IN (:qualityLabels)
            ORDER BY c.created_at, c.id
            LIMIT 1
            FOR UPDATE SKIP LOCKED""", nativeQuery = true)
    Optional<Clip> lockOldestWaiting(@Param("status") String status,
                                     @Param("qualityLabels") Collection<String> qualityLabels);

    /**
     * Like {@link #findById} but locks the row until the surrounding transaction ends: whoever changes a clip that a
     * recorder holds takes this lock first and looks at the clip again under it.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Clip c where c.id = :id")
    Optional<Clip> findByIdForUpdate(@Param("id") long id);

    /** Whether the clip is held by that recorder: claimed by it and in one of {@code activeStatuses}. A look, no lock. */
    @Query("""
            select count(c) > 0 from Clip c
            where c.id = :id and c.claimedBy = :worker and c.status in :activeStatuses""")
    boolean isHeldBy(@Param("id") long id, @Param("worker") String worker,
                     @Param("activeStatuses") Collection<ClipStatus> activeStatuses);

    /**
     * The ids of the active clips whose recorder has given no sign of life since {@code cutoff}; a clip without a
     * heartbeat counts as silent. A look, no lock: the caller takes the lock of each clip and looks again.
     */
    @Query("""
            select c.id from Clip c
            where c.status in :activeStatuses and (c.heartbeatAt is null or c.heartbeatAt < :cutoff)
            order by c.id""")
    List<Long> findSilentIds(@Param("activeStatuses") Collection<ClipStatus> activeStatuses,
                             @Param("cutoff") Instant cutoff);
}
