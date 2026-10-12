package io.csfaceit.backend.clip;

import static io.csfaceit.backend.match.MatchController.MATCH_ID_MESSAGE;
import static io.csfaceit.backend.match.MatchController.MATCH_ID_PATTERN;
import static io.csfaceit.backend.player.PlayerController.PLAYER_ID_MESSAGE;
import static io.csfaceit.backend.player.PlayerController.PLAYER_ID_PATTERN;

import io.csfaceit.backend.clip.ClipService.ClipCreation;
import io.csfaceit.backend.clip.dto.ClipPageResponse;
import io.csfaceit.backend.clip.dto.ClipRequest;
import io.csfaceit.backend.clip.dto.ClipResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Asking for the clip of a highlight, and reading clips. The request is a {@code POST} and needs the admin key like
 * every other write; the reads are open and answer from the database only: an id the database does not know gives an
 * empty list, not a 404 (a single clip that does not exist is a 404). A {@code quality} that is not one of the
 * {@link ClipQuality} labels is a 400.
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

    @GetMapping("/clips/{clipId}")
    public ClipResponse getClip(@PathVariable long clipId) {
        return queries.get(clipId);
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

    /** The clips that are done, the most recently finished first. */
    @GetMapping("/clips")
    public ClipPageResponse getFinishedClips(
            @RequestParam(defaultValue = "0") @Min(0) @Max(MAX_OFFSET) int offset,
            @RequestParam(defaultValue = "20") @Min(1) @Max(MAX_LIMIT) int limit) {
        return queries.latest(offset, limit);
    }
}
