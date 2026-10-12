package io.csfaceit.backend.player;

import io.csfaceit.backend.player.dto.MatchHistoryResponse;
import io.csfaceit.backend.player.dto.PlayerResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/players")
@Validated
public class PlayerController {

    private static final String NICKNAME_PATTERN = "^[A-Za-z0-9_-]{2,32}$";
    private static final String NICKNAME_MESSAGE = "must be 2-32 characters: letters, digits, '_' or '-'";

    /** FACEIT ids are UUID-like. They end up in Redis keys ({@code faceit:player:{id}}), so no punctuation. */
    public static final String PLAYER_ID_PATTERN = "^[A-Za-z0-9-]{1,64}$";
    public static final String PLAYER_ID_MESSAGE = "must be 1-64 characters: letters, digits or '-'";

    /**
     * FACEIT rejects a history offset above 1000 with a 400, which would otherwise surface as a 502. Public because
     * the list of matches, which is a page of the history, checks its {@code offset} against the same limit.
     */
    public static final int MAX_HISTORY_OFFSET = 1000;

    private final PlayerService service;

    public PlayerController(PlayerService service) {
        this.service = service;
    }

    @GetMapping
    public PlayerResponse searchByNickname(
            @RequestParam @Pattern(regexp = NICKNAME_PATTERN, message = NICKNAME_MESSAGE) String nickname) {
        return service.findByNickname(nickname);
    }

    @GetMapping("/{playerId}")
    public PlayerResponse getById(
            @PathVariable @Pattern(regexp = PLAYER_ID_PATTERN, message = PLAYER_ID_MESSAGE) String playerId) {
        return service.getById(playerId);
    }

    @GetMapping("/{playerId}/history")
    public MatchHistoryResponse getHistory(
            @PathVariable @Pattern(regexp = PLAYER_ID_PATTERN, message = PLAYER_ID_MESSAGE) String playerId,
            @RequestParam(defaultValue = "0") @Min(0) @Max(MAX_HISTORY_OFFSET) int offset,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit) {
        return service.getHistory(playerId, offset, limit);
    }
}
