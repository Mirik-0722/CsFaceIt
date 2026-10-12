package io.csfaceit.backend.clip;

import io.csfaceit.backend.analysis.highlight.HighlightType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
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
}
