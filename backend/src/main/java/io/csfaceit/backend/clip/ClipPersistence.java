package io.csfaceit.backend.clip;

import io.csfaceit.backend.analysis.highlight.HighlightType;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.player.PlayerRepository;
import java.util.List;
import java.util.Optional;
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

    /**
     * What tells the clip of a highlight apart from every other: the highlight by its natural key (its id is no handle,
     * an analysis replaces it), and the quality. The ids are those of the rows, not FACEIT's.
     */
    public record HighlightKey(long matchRowId, long playerRowId, HighlightType type, int roundNumber, int tickStart,
                               ClipQuality quality) {
    }

    /**
     * What tells the compilation of a player's kills apart from every other clip: the match, the player and the
     * quality. The ids are those of the rows, not FACEIT's.
     */
    public record CompilationKey(long matchRowId, long playerRowId, ClipQuality quality) {
    }

    private final ClipRepository clips;
    private final MatchRepository matches;
    private final PlayerRepository players;

    public ClipPersistence(ClipRepository clips, MatchRepository matches, PlayerRepository players) {
        this.clips = clips;
        this.matches = matches;
        this.players = players;
    }

    /** The id of the clip that already stands for the highlight at that quality, if there is one that is not FAILED. */
    @Transactional(readOnly = true)
    public Optional<Long> findLiveHighlightClip(HighlightKey key) {
        return clips.findLiveHighlightClipId(key.matchRowId(), key.playerRowId(), key.type(), key.roundNumber(),
                key.tickStart(), key.quality());
    }

    /** How many clips are waiting for a recorder. */
    @Transactional(readOnly = true)
    public long countQueued() {
        return clips.countByStatus(ClipStatus.QUEUED);
    }

    /**
     * Puts the clip of a highlight in the queue, as {@code QUEUED}, and returns its id.
     *
     * @param tickEnd the last tick of the highlight (its first is in the key)
     * @param fps the frames per second the clip is to be recorded at
     * @param segments the stretches of the demo the video is made of
     */
    @Transactional
    public long queueHighlightClip(HighlightKey key, int tickEnd, int fps, List<ClipSegment> segments) {
        Clip clip = Clip.highlight(matches.getReferenceById(key.matchRowId()),
                players.getReferenceById(key.playerRowId()), key.type(), key.roundNumber(), key.tickStart(), tickEnd,
                key.quality(), fps, segments);
        return clips.saveAndFlush(clip).getId();
    }

    /** The id of the compilation that already stands for the key, if there is one that is not FAILED. */
    @Transactional(readOnly = true)
    public Optional<Long> findLiveCompilation(CompilationKey key) {
        return clips.findLiveCompilationClipId(key.matchRowId(), key.playerRowId(), key.quality());
    }

    /**
     * Puts the compilation of a player's kills in a match in the queue, as {@code QUEUED}, and returns its id.
     *
     * @param fps the frames per second the clip is to be recorded at
     * @param segments the stretches of the demo the video is made of, round after round
     */
    @Transactional
    public long queueCompilation(CompilationKey key, int fps, List<ClipSegment> segments) {
        Clip clip = Clip.compilation(matches.getReferenceById(key.matchRowId()),
                players.getReferenceById(key.playerRowId()), key.quality(), fps, segments);
        return clips.saveAndFlush(clip).getId();
    }
}
