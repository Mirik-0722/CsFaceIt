package io.csfaceit.backend.analysis.api;

import static io.csfaceit.backend.player.PlayerController.PLAYER_ID_MESSAGE;
import static io.csfaceit.backend.player.PlayerController.PLAYER_ID_PATTERN;

import io.csfaceit.backend.analysis.api.dto.PlayerAggregateStatsResponse;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * A player's statistics over the matches the backend has stored. A {@code GET}, open like the other read endpoints,
 * answered from the database only: a player the database does not know is a 200 with {@code matches} 0, not a 404.
 */
@RestController
@RequestMapping("/api/v1/players")
@Validated
public class PlayerStatsController {

    private final StatsQueryService stats;

    public PlayerStatsController(StatsQueryService stats) {
        this.stats = stats;
    }

    @GetMapping("/{playerId}/stats")
    public PlayerAggregateStatsResponse getStats(
            @PathVariable @Pattern(regexp = PLAYER_ID_PATTERN, message = PLAYER_ID_MESSAGE) String playerId) {
        return stats.aggregate(playerId);
    }
}
