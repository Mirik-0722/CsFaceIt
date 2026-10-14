package io.csfaceit.backend.player;

import static io.csfaceit.backend.player.PlayerController.ANY_PLAYER_ID_MESSAGE;
import static io.csfaceit.backend.player.PlayerController.ANY_PLAYER_ID_PATTERN;
import static io.csfaceit.backend.player.PlayerController.MAX_HISTORY_OFFSET;

import io.csfaceit.backend.player.dto.MatchHistoryResponse;
import io.csfaceit.backend.player.dto.PlayerMatchListResponse;
import io.csfaceit.backend.player.dto.PlayerOverviewResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import java.time.Instant;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * What the player page and the list of matches show beyond the profile: the player's results by map and highlights by
 * type, and his FACEIT history with what the backend knows of each match. Both are {@code GET}s, open like the other
 * reads of a player.
 *
 * <p>The overview answers from the database only: a player it does not know is a 200 with empty lists, not a 404. The
 * list of matches is the page {@code GET .../history} returns for the same {@code offset} and {@code limit}, with the
 * same checks of them, and a failure of FACEIT is answered as that endpoint answers it (404 {@code PLAYER_NOT_FOUND},
 * 502 {@code FACEIT_UNAVAILABLE}); only then is the database asked, once for the whole page.
 */
@RestController
@RequestMapping("/api/v1/players")
@Validated
public class PlayerOverviewController {

    /** As {@code GET .../history}, whose page this one is. */
    private static final int MAX_LIMIT = 100;

    private final PlayerService players;
    private final PlayerOverviewService overview;

    public PlayerOverviewController(PlayerService players, PlayerOverviewService overview) {
        this.players = players;
        this.overview = overview;
    }

    @GetMapping("/{playerId}/overview")
    public PlayerOverviewResponse getOverview(
            @PathVariable @Pattern(regexp = ANY_PLAYER_ID_PATTERN, message = ANY_PLAYER_ID_MESSAGE) String playerId) {
        return overview.overview(playerId);
    }

    /**
     * The history is loaded first and with no transaction open, so that no database connection is held while FACEIT
     * is waited for; the service then reads the whole page in one, with the person's matchmaking matches of the page's
     * stretch of time. {@code before} is the start of the last row of the page before (as that page answered it), and
     * bounds the matchmaking matches of this one from above.
     *
     * <p>A player known only from demos ({@code steam:<SteamID>}) has no FACEIT history: his list is the database's
     * matchmaking matches, paged by {@code offset} and {@code limit}; {@code before} is not needed for it.
     */
    @GetMapping("/{playerId}/matches")
    public PlayerMatchListResponse getMatches(
            @PathVariable @Pattern(regexp = ANY_PLAYER_ID_PATTERN, message = ANY_PLAYER_ID_MESSAGE) String playerId,
            @RequestParam(defaultValue = "0") @Min(0) @Max(MAX_HISTORY_OFFSET) int offset,
            @RequestParam(defaultValue = "20") @Min(1) @Max(MAX_LIMIT) int limit,
            @RequestParam(required = false) Instant before) {
        if (PlayerService.isSteamPlayerId(playerId)) {
            return overview.matchmakingMatches(playerId, offset, limit);
        }
        MatchHistoryResponse history = players.getHistory(playerId, offset, limit);
        return overview.matches(playerId, history, before);
    }
}
