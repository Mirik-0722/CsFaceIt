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
    public static final String MATCH_ID_PATTERN = "^[A-Za-z0-9-]{1,64}$";
    public static final String MATCH_ID_MESSAGE = "must be 1-64 characters: letters, digits or '-'";

    private final MatchService service;
    private final DemoScoreboard scoreboard;

    public MatchController(MatchService service, DemoScoreboard scoreboard) {
        this.service = service;
        this.scoreboard = scoreboard;
    }

    /** A matchmaking match ({@code mm-<id>}) is answered from the database; FACEIT is asked for the others only. */
    @GetMapping("/{matchId}")
    public MatchResponse getMatch(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return MatchSource.isMatchmaking(matchId) ? scoreboard.match(matchId) : service.getMatch(matchId);
    }

    @GetMapping("/{matchId}/stats")
    public MatchStatsResponse getStats(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return MatchSource.isMatchmaking(matchId) ? scoreboard.stats(matchId) : service.getStats(matchId);
    }
}
