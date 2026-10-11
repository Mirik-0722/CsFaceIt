package io.csfaceit.backend.analysis.api;

import static io.csfaceit.backend.match.MatchController.MATCH_ID_MESSAGE;
import static io.csfaceit.backend.match.MatchController.MATCH_ID_PATTERN;
import static io.csfaceit.backend.player.PlayerController.PLAYER_ID_MESSAGE;
import static io.csfaceit.backend.player.PlayerController.PLAYER_ID_PATTERN;

import io.csfaceit.backend.analysis.api.dto.HighlightPageResponse;
import io.csfaceit.backend.analysis.api.dto.HighlightResponse;
import io.csfaceit.backend.analysis.highlight.HighlightType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import java.util.List;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The highlights the analysis found, of a match and of a player. Both are {@code GET}s, open like the other read
 * endpoints, and answer from the database only: an id the database does not know, or a match whose demo is not
 * {@code ANALYZED}, gives an empty list, not a 404. A {@code type} that is not a {@link HighlightType} is a 400.
 */
@RestController
@RequestMapping("/api/v1")
@Validated
public class HighlightController {

    private static final int MAX_OFFSET = 10_000;
    private static final int MAX_LIMIT = 100;

    private final HighlightQueryService highlights;

    public HighlightController(HighlightQueryService highlights) {
        this.highlights = highlights;
    }

    @GetMapping("/matches/{matchId}/highlights")
    public List<HighlightResponse> getMatchHighlights(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId,
            @RequestParam(required = false) HighlightType type,
            @RequestParam(required = false) @Pattern(regexp = PLAYER_ID_PATTERN, message = PLAYER_ID_MESSAGE)
            String playerId) {
        return highlights.forMatch(matchId, type, playerId);
    }

    @GetMapping("/players/{playerId}/highlights")
    public HighlightPageResponse getPlayerHighlights(
            @PathVariable @Pattern(regexp = PLAYER_ID_PATTERN, message = PLAYER_ID_MESSAGE) String playerId,
            @RequestParam(required = false) HighlightType type,
            @RequestParam(defaultValue = "0") @Min(0) @Max(MAX_OFFSET) int offset,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_LIMIT) int limit) {
        return highlights.forPlayer(playerId, type, offset, limit);
    }
}
