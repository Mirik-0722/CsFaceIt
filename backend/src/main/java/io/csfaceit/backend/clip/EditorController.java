package io.csfaceit.backend.clip;

import static io.csfaceit.backend.match.MatchController.MATCH_ID_MESSAGE;
import static io.csfaceit.backend.match.MatchController.MATCH_ID_PATTERN;

import io.csfaceit.backend.clip.dto.CompilationRequest;
import io.csfaceit.backend.clip.dto.EditorSource;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * What the montage editor of a player in a match is built from. A {@code GET}, open like the other reads and answered
 * from the database only (see {@link EditorService}); the order of the montage is {@code POST
 * /api/v1/matches/{matchId}/montages} in {@link ClipController}. {@code playerId} is required, the FACEIT player id or
 * {@code steam:<SteamID>}; a malformed one is a 400.
 */
@RestController
@RequestMapping("/api/v1/matches")
@Validated
public class EditorController {

    private final EditorService editor;

    public EditorController(EditorService editor) {
        this.editor = editor;
    }

    @GetMapping("/{matchId}/editor")
    public EditorSource getEditorSource(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId,
            @RequestParam @Pattern(regexp = CompilationRequest.PLAYER_ID_PATTERN,
                    message = CompilationRequest.PLAYER_ID_MESSAGE) String playerId) {
        return editor.source(matchId, playerId);
    }
}
