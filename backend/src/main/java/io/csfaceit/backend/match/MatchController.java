package io.csfaceit.backend.match;

import io.csfaceit.backend.match.dto.MatchResponse;
import io.csfaceit.backend.match.dto.MatchStatsResponse;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/matches")
@Validated
public class MatchController {

    /** FACEIT match ids look like {@code 1-<uuid>}. They end up in Redis keys ({@code faceit:match:{id}}). */
    private static final String MATCH_ID_PATTERN = "^[A-Za-z0-9-]{1,64}$";
    private static final String MATCH_ID_MESSAGE = "must be 1-64 characters: letters, digits or '-'";

    private final MatchService service;

    public MatchController(MatchService service) {
        this.service = service;
    }

    @GetMapping("/{matchId}")
    public MatchResponse getMatch(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return service.getMatch(matchId);
    }

    @GetMapping("/{matchId}/stats")
    public MatchStatsResponse getStats(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return service.getStats(matchId);
    }
}
