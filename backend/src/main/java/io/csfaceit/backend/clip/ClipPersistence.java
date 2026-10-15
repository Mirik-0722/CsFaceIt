package io.csfaceit.backend.clip;

import io.csfaceit.backend.analysis.highlight.HighlightType;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.player.PlayerRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The database writes behind the clip endpoints. It is a bean of its own so that the transaction proxy applies:
 * {@link ClipService} reads facts and computes with no transaction open and calls in here for each short step.
 *
 * <p>When a concurrent request inserts the same clip first, PostgreSQL fails the insert with a unique violation
 * ({@code uq_clips_highlight}, or {@code uq_clips_compilation} for a compilation), which aborts the whole transaction
 * and surfaces as a {@link org.springframework.dao.DataIntegrityViolationException}; nothing is recovered in here. The
 * caller looks for the clip again, and finds the other request's.
 */
@Component
public class ClipPersistence {

    private static final String CLIP_NOT_FOUND = "CLIP_NOT_FOUND";
    private static final String CLIP_IN_PROGRESS = "CLIP_IN_PROGRESS";
    private static final String CLIP_NOT_FAILED = "CLIP_NOT_FAILED";

    /** The two statuses a clip ends in, from which it never moves on. */
    private static final List<ClipStatus> FINISHED_STATUSES = List.of(ClipStatus.DONE, ClipStatus.FAILED);

    /**
     * What a deleted clip may have left in the storage: the files of {@code attempts} attempts (see {@link ClipFiles}),
     * and the files its row named, {@code videoKey} and {@code thumbnailKey}, which are {@code null} while it has none.
     */
    public record DeletedClip(int attempts, String videoKey, String thumbnailKey) {
    }

    /**
     * A failed clip as a retry needs it: what it was a clip of (its key, its quality and its frame rate, by the ids of
     * the rows; the three fields of a highlight are {@code null} in a compilation and a montage) and who ordered it. A
     * montage is ordered again with its own {@code segments} and {@code options}; {@code options} is {@code null} for
     * every other kind, whose segments are worked out again from the facts.
     */
    public record FailedClip(ClipKind kind, long matchRowId, long playerRowId, HighlightType highlightType,
                             Integer roundNumber, Integer tickStart, Integer tickEnd, ClipQuality quality, int fps,
                             Long requestedBy, List<ClipSegment> segments, MontageOptions options) {
    }

    /**
     * What tells the clip of a highlight apart from every other: the highlight by its natural key (its id is no handle,
     * an analysis replaces it), the quality and the frame rate. The ids are those of the rows, not FACEIT's.
     */
    public record HighlightKey(long matchRowId, long playerRowId, HighlightType type, int roundNumber, int tickStart,
                               ClipQuality quality, int fps) {
    }

    /**
     * What tells the compilation of a player's kills apart from every other clip: the match, the player, the quality
     * and the frame rate. The ids are those of the rows, not FACEIT's.
     */
    public record CompilationKey(long matchRowId, long playerRowId, ClipQuality quality, int fps) {
    }

    private final ClipRepository clips;
    private final MatchRepository matches;
    private final PlayerRepository players;

    public ClipPersistence(ClipRepository clips, MatchRepository matches, PlayerRepository players) {
        this.clips = clips;
        this.matches = matches;
        this.players = players;
    }

    /**
     * The id of the clip that already stands for the highlight at that quality and frame rate, if there is one that is
     * not FAILED.
     */
    @Transactional(readOnly = true)
    public Optional<Long> findLiveHighlightClip(HighlightKey key) {
        return clips.findLiveHighlightClipId(key.matchRowId(), key.playerRowId(), key.type(), key.roundNumber(),
                key.tickStart(), key.quality(), key.fps());
    }

    /** How many clips are waiting for a recorder. */
    @Transactional(readOnly = true)
    public long countQueued() {
        return clips.countByStatus(ClipStatus.QUEUED);
    }

    /**
     * Deletes the row of a clip. It is read under its lock and looked at again there, so that it cannot be claimed by a
     * recorder in the same moment: whoever gets the lock first wins, and a delete that comes second finds the clip
     * active. A {@code QUEUED} clip is deleted too, which is how a request is withdrawn.
     *
     * @param requireOwner asked under the lock with {@code clips.requested_by} of the clip ({@code null} when it has
     *        none), and throws when whoever is deleting may not: the rule is the caller's, the lock is this method's.
     *        The clean-up of old clips passes one that allows everything.
     * @return what the clip leaves in the storage, read before the row went
     * @throws NotFoundException {@code CLIP_NOT_FOUND}
     * @throws ConflictException {@code CLIP_IN_PROGRESS}: a recorder holds the clip
     */
    @Transactional
    public DeletedClip delete(long clipId, Consumer<Long> requireOwner) {
        Clip clip = clips.findByIdForUpdate(clipId)
                .orElseThrow(() -> new NotFoundException(CLIP_NOT_FOUND, "Clip not found: " + clipId));
        requireOwner.accept(clip.getRequestedBy());
        if (clip.getStatus().isActive()) {
            throw new ConflictException(CLIP_IN_PROGRESS,
                    "Clip " + clipId + " is being made (" + clip.getStatus() + ") and cannot be deleted now");
        }
        DeletedClip deleted = new DeletedClip(clip.getAttempts(), clip.getVideoKey(), clip.getThumbnailKey());
        clips.delete(clip);
        return deleted;
    }

    /**
     * Reads a clip that is to be recorded again. It is read under its lock like a delete, so that the owner and the
     * status are those of one moment; {@code FAILED} is final, so what is returned stays true after the lock is gone.
     *
     * @param requireOwner as for {@link #delete}
     * @throws NotFoundException {@code CLIP_NOT_FOUND}
     * @throws ConflictException {@code CLIP_NOT_FAILED}: the clip is waiting, being made or done
     */
    @Transactional
    public FailedClip findFailed(long clipId, Consumer<Long> requireOwner) {
        Clip clip = clips.findByIdForUpdate(clipId)
                .orElseThrow(() -> new NotFoundException(CLIP_NOT_FOUND, "Clip not found: " + clipId));
        requireOwner.accept(clip.getRequestedBy());
        if (clip.getStatus() != ClipStatus.FAILED) {
            throw new ConflictException(CLIP_NOT_FAILED,
                    "Clip " + clipId + " is " + clip.getStatus() + ", and only a failed clip can be tried again");
        }
        return new FailedClip(clip.getKind(), clip.getMatch().getId(), clip.getPlayer().getId(),
                clip.getHighlightType(), clip.getRoundNumber(), clip.getTickStart(), clip.getTickEnd(),
                clip.getQuality(), clip.getFps(), clip.getRequestedBy(), List.copyOf(clip.getSegments()),
                clip.getOptions());
    }

    /** The ids of the clips that finished ({@code DONE} or {@code FAILED}) before {@code cutoff}, the oldest first. */
    @Transactional(readOnly = true)
    public List<Long> findFinishedBefore(Instant cutoff) {
        return clips.findFinishedBeforeIds(FINISHED_STATUSES, cutoff);
    }

    /**
     * Puts the clip of a highlight in the queue, as {@code QUEUED}, and returns its id.
     *
     * @param tickEnd the last tick of the highlight (its first is in the key, and so are its quality and frame rate)
     * @param segments the stretches of the demo the video is made of
     * @param requestedBy the id of the user who orders the clip, {@code null} for the admin key
     * @param beforeInsert runs in this transaction before the clip is written, and stops the order by throwing. This is
     *        where a limit per day counts the order: what it writes is committed with the clip or not at all, so a
     *        clip that is not queued after all (a concurrent request queued the same one) is not counted either.
     */
    @Transactional
    public long queueHighlightClip(HighlightKey key, int tickEnd, List<ClipSegment> segments, Long requestedBy,
                                   Runnable beforeInsert) {
        beforeInsert.run();
        Clip clip = Clip.highlight(matches.getReferenceById(key.matchRowId()),
                players.getReferenceById(key.playerRowId()), key.type(), key.roundNumber(), key.tickStart(), tickEnd,
                key.quality(), key.fps(), segments, requestedBy);
        return clips.saveAndFlush(clip).getId();
    }

    /** The id of the compilation that already stands for the key, if there is one that is not FAILED. */
    @Transactional(readOnly = true)
    public Optional<Long> findLiveCompilation(CompilationKey key) {
        return clips.findLiveCompilationClipId(key.matchRowId(), key.playerRowId(), key.quality(), key.fps());
    }

    /**
     * Puts the compilation of a player's kills in a match in the queue, as {@code QUEUED}, and returns its id.
     *
     * @param segments the stretches of the demo the video is made of, round after round
     * @param requestedBy the id of the user who orders the clip, {@code null} for the admin key
     * @param beforeInsert as for {@link #queueHighlightClip}
     */
    @Transactional
    public long queueCompilation(CompilationKey key, List<ClipSegment> segments, Long requestedBy,
                                 Runnable beforeInsert) {
        beforeInsert.run();
        Clip clip = Clip.compilation(matches.getReferenceById(key.matchRowId()),
                players.getReferenceById(key.playerRowId()), key.quality(), key.fps(), segments, requestedBy);
        return clips.saveAndFlush(clip).getId();
    }

    /**
     * Puts a montage in the queue, as {@code QUEUED}, and returns its id. No index keeps a montage unique: every order
     * is a clip of its own.
     *
     * @param fps the frames per second the montage is to be recorded at
     * @param segments the stretches of the demo the video is made of, in the order the player put them in
     * @param options what the montage is recorded with besides its segments
     * @param requestedBy the id of the user who orders the clip, {@code null} for the admin key
     * @param beforeInsert as for {@link #queueHighlightClip}
     */
    @Transactional
    public long queueMontage(long matchRowId, long playerRowId, ClipQuality quality, int fps,
                             List<ClipSegment> segments, MontageOptions options, Long requestedBy,
                             Runnable beforeInsert) {
        beforeInsert.run();
        Clip clip = Clip.montage(matches.getReferenceById(matchRowId), players.getReferenceById(playerRowId), quality,
                fps, segments, options, requestedBy);
        return clips.saveAndFlush(clip).getId();
    }
}
