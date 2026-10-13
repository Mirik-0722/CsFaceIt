package io.csfaceit.backend.clip;

import static io.csfaceit.backend.match.MatchController.MATCH_ID_MESSAGE;
import static io.csfaceit.backend.match.MatchController.MATCH_ID_PATTERN;
import static io.csfaceit.backend.player.PlayerController.PLAYER_ID_MESSAGE;
import static io.csfaceit.backend.player.PlayerController.PLAYER_ID_PATTERN;

import io.csfaceit.backend.auth.Access;
import io.csfaceit.backend.clip.ClipService.ClipCreation;
import io.csfaceit.backend.clip.dto.ClipPageResponse;
import io.csfaceit.backend.clip.dto.ClipRequest;
import io.csfaceit.backend.clip.dto.ClipResponse;
import io.csfaceit.backend.clip.dto.CompilationRequest;
import io.csfaceit.backend.clip.dto.MontageRequest;
import io.csfaceit.backend.clip.dto.RecorderStatusResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Asking for the clip of a highlight, for the compilation of a player's kills in a match or for a montage of them,
 * trying a failed clip again, deleting a clip, and reading clips and the state of the recorder. The four requests are
 * {@code POST}s and the
 * delete a {@code DELETE}; they take the admin key or a session, and a user who is no administrator acts for their own
 * player and their own clips only, which {@link ClipService} asks {@link Access} about (403 otherwise). The controller
 * only says who is acting, and who is reading: every clip in an answer says whether it is the reader's own
 * ({@code mine}). The reads are open and answer from the database only: an id the
 * database does not know gives an empty list, not a 404 (a single clip that does not exist is a 404). A {@code quality}
 * that is not one of the {@link ClipQuality} labels is a 400. The video and the thumbnail of a clip are served by
 * {@link ClipMediaController}.
 */
@RestController
@RequestMapping("/api/v1")
@Validated
public class ClipController {

    private static final int MAX_OFFSET = 10_000;
    private static final int MAX_LIMIT = 100;

    private final ClipService clips;
    private final ClipQueryService queries;
    private final Access access;

    public ClipController(ClipService clips, ClipQueryService queries, Access access) {
        this.clips = clips;
        this.queries = queries;
        this.access = access;
    }

    /** 201 for the clip this request queued, 200 for the one that already stood for the highlight at that quality. */
    @PostMapping("/highlights/{highlightId}/clips")
    public ResponseEntity<ClipResponse> requestHighlightClip(@PathVariable long highlightId,
                                                             @RequestBody(required = false) ClipRequest request) {
        ClipQuality quality = (request == null ? new ClipRequest(null) : request).quality();
        ClipCreation creation = clips.requestHighlightClip(access.current(), highlightId, quality);
        return ResponseEntity.status(creation.created() ? HttpStatus.CREATED : HttpStatus.OK).body(creation.clip());
    }

    /**
     * 201 for the compilation of a player's kills in the match that this request queued, 200 for the one that already
     * stood for the player at that quality. The body names the player and is required: a request without one, or with
     * a malformed player id, is a 400.
     */
    @PostMapping("/matches/{matchId}/clips")
    public ResponseEntity<ClipResponse> requestCompilation(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId,
            @Valid @RequestBody CompilationRequest request) {
        ClipCreation creation = clips.requestCompilation(access.current(), matchId, request.playerId(),
                request.quality());
        return ResponseEntity.status(creation.created() ? HttpStatus.CREATED : HttpStatus.OK).body(creation.clip());
    }

    /**
     * 202 with the montage this request queued: every order is a new clip, also one exactly like a montage that
     * stands. The body names the player and is required, as for a compilation; what else is wrong with it is a 400
     * {@code INVALID_MONTAGE_OPTION} or {@code INVALID_SEGMENTS} (see {@link MontageRequest}).
     */
    @PostMapping("/matches/{matchId}/montages")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ClipResponse requestMontage(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId,
            @Valid @RequestBody MontageRequest request) {
        return clips.requestMontage(access.current(), matchId, request).clip();
    }

    @GetMapping("/clips/{clipId}")
    public ClipResponse getClip(@PathVariable long clipId) {
        return queries.get(clipId, access.viewerId());
    }

    /**
     * Orders a failed clip again, at the same quality: 201 with the new clip, and the failed one is gone. 409
     * {@code CLIP_NOT_FAILED} for a clip that is waiting, being made or done. (200 with the clip that stands, when
     * someone ordered the same clip again before this request.)
     */
    @PostMapping("/clips/{clipId}/retry")
    public ResponseEntity<ClipResponse> retryClip(@PathVariable long clipId) {
        ClipCreation creation = clips.retry(access.current(), clipId);
        return ResponseEntity.status(creation.created() ? HttpStatus.CREATED : HttpStatus.OK).body(creation.clip());
    }

    /**
     * Deletes the clip and its files: 204. A clip a recorder is working on is a 409 {@code CLIP_IN_PROGRESS}; one that
     * is only waiting can be deleted, which withdraws the request.
     */
    @DeleteMapping("/clips/{clipId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteClip(@PathVariable long clipId) {
        clips.delete(access.current(), clipId);
    }

    @GetMapping("/matches/{matchId}/clips")
    public List<ClipResponse> getMatchClips(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return queries.forMatch(matchId, access.viewerId());
    }

    @GetMapping("/players/{playerId}/clips")
    public ClipPageResponse getPlayerClips(
            @PathVariable @Pattern(regexp = PLAYER_ID_PATTERN, message = PLAYER_ID_MESSAGE) String playerId,
            @RequestParam(defaultValue = "0") @Min(0) @Max(MAX_OFFSET) int offset,
            @RequestParam(defaultValue = "20") @Min(1) @Max(MAX_LIMIT) int limit) {
        return queries.forPlayer(playerId, offset, limit, access.viewerId());
    }

    /** Whether a recorder is online to take the clips that wait, and how many wait and are being recorded. */
    @GetMapping("/recorder/status")
    public RecorderStatusResponse getRecorderStatus() {
        return queries.recorderStatus();
    }

    /** The clips that are done, the most recently finished first. */
    @GetMapping("/clips")
    public ClipPageResponse getFinishedClips(
            @RequestParam(defaultValue = "0") @Min(0) @Max(MAX_OFFSET) int offset,
            @RequestParam(defaultValue = "20") @Min(1) @Max(MAX_LIMIT) int limit) {
        return queries.latest(offset, limit, access.viewerId());
    }
}
