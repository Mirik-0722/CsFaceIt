package io.csfaceit.backend.analysis.api;

import static io.csfaceit.backend.match.MatchController.MATCH_ID_MESSAGE;
import static io.csfaceit.backend.match.MatchController.MATCH_ID_PATTERN;

import io.csfaceit.backend.analysis.api.dto.MatchBreakdownResponse;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The breakdown of a match: who won each round, and the numbers the analysis computed for each player. A {@code GET},
 * open like the other read endpoints, answered from the database only: a match the database does not know, or whose
 * demo is not {@code ANALYZED}, gives two empty lists, not a 404.
 */
@RestController
@RequestMapping("/api/v1/matches")
@Validated
public class MatchBreakdownController {

    private final MatchBreakdownQueryService breakdown;

    public MatchBreakdownController(MatchBreakdownQueryService breakdown) {
        this.breakdown = breakdown;
    }

    @GetMapping("/{matchId}/breakdown")
    public MatchBreakdownResponse getBreakdown(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return breakdown.forMatch(matchId);
    }
}
