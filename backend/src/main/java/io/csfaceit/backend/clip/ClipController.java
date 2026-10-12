package io.csfaceit.backend.clip;

import static io.csfaceit.backend.match.MatchController.MATCH_ID_MESSAGE;
import static io.csfaceit.backend.match.MatchController.MATCH_ID_PATTERN;
import static io.csfaceit.backend.player.PlayerController.PLAYER_ID_MESSAGE;
import static io.csfaceit.backend.player.PlayerController.PLAYER_ID_PATTERN;

import io.csfaceit.backend.clip.ClipService.ClipCreation;
import io.csfaceit.backend.clip.dto.ClipPageResponse;
import io.csfaceit.backend.clip.dto.ClipRequest;
import io.csfaceit.backend.clip.dto.ClipResponse;
import io.csfaceit.backend.clip.dto.CompilationRequest;
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
 * Asking for the clip of a highlight, deleting a clip, and reading clips and the state of the recorder. The request and
 * the delete are a {@code POST} and a {@code DELETE} and need the admin key like every other write; the reads are open
 * and answer from the database only: an id the database does not know gives an empty list, not a 404 (a single clip
 * that does not exist is a 404). A {@code quality} that is not one of the {@link ClipQuality} labels is a 400. The
 * video and the thumbnail of a clip are served by {@link ClipMediaController}.
 */
@RestController
@RequestMapping("/api/v1")
@Validated
public class ClipController {

    private static final int MAX_OFFSET = 10_000;
    private static final int MAX_LIMIT = 100;

    private final ClipService clips;
    private final ClipQueryService queries;

    public ClipController(ClipService clips, ClipQueryService queries) {
        this.clips = clips;
        this.queries = queries;
    }

    /** 201 for the clip this request queued, 200 for the one that already stood for the highlight at that quality. */
    @PostMapping("/highlights/{highlightId}/clips")
    public ResponseEntity<ClipResponse> requestHighlightClip(@PathVariable long highlightId,
                                                             @RequestBody(required = false) ClipRequest request) {
        ClipQuality quality = (request == null ? new ClipRequest(null) : request).quality();
        ClipCreation creation = clips.requestHighlightClip(highlightId, quality);
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
        ClipCreation creation = clips.requestCompilation(matchId, request.playerId(), request.quality());
        return ResponseEntity.status(creation.created() ? HttpStatus.CREATED : HttpStatus.OK).body(creation.clip());
    }

    @GetMapping("/clips/{clipId}")
    public ClipResponse getClip(@PathVariable long clipId) {
        return queries.get(clipId);
    }

    /**
     * Deletes the clip and its files: 204. A clip a recorder is working on is a 409 {@code CLIP_IN_PROGRESS}; one that
     * is only waiting can be deleted, which withdraws the request.
     */
    @DeleteMapping("/clips/{clipId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteClip(@PathVariable long clipId) {
        clips.delete(clipId);
    }

    @GetMapping("/matches/{matchId}/clips")
    public List<ClipResponse> getMatchClips(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return queries.forMatch(matchId);
    }

    @GetMapping("/players/{playerId}/clips")
    public ClipPageResponse getPlayerClips(
            @PathVariable @Pattern(regexp = PLAYER_ID_PATTERN, message = PLAYER_ID_MESSAGE) String playerId,
            @RequestParam(defaultValue = "0") @Min(0) @Max(MAX_OFFSET) int offset,
            @RequestParam(defaultValue = "20") @Min(1) @Max(MAX_LIMIT) int limit) {
        return queries.forPlayer(playerId, offset, limit);
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
        return queries.latest(offset, limit);
    }
}
