package io.csfaceit.backend.analysis.api;

import static io.csfaceit.backend.player.PlayerController.ANY_PLAYER_ID_MESSAGE;
import static io.csfaceit.backend.player.PlayerController.ANY_PLAYER_ID_PATTERN;

import io.csfaceit.backend.analysis.api.dto.PlayerAggregateStatsResponse;
import io.csfaceit.backend.player.PlayerService;
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
    private final PlayerService players;

    public PlayerStatsController(StatsQueryService stats, PlayerService players) {
        this.stats = stats;
        this.players = players;
    }

    /** {@code steam:<SteamID>} reads the row that stands for it ({@link PlayerService#resolveSteamPlayerId}). */
    @GetMapping("/{playerId}/stats")
    public PlayerAggregateStatsResponse getStats(
            @PathVariable @Pattern(regexp = ANY_PLAYER_ID_PATTERN, message = ANY_PLAYER_ID_MESSAGE) String playerId) {
        return stats.aggregate(PlayerService.isSteamPlayerId(playerId) ? players.resolveSteamPlayerId(playerId)
                : playerId);
    }
}
