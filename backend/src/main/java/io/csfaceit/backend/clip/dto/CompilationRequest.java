package io.csfaceit.backend.clip.dto;

import io.csfaceit.backend.clip.ClipFps;
import io.csfaceit.backend.clip.ClipQuality;
import io.csfaceit.backend.player.PlayerController;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * The body of a request for the compilation of a player's kills in a match. {@code playerId} is required: the FACEIT
 * player id, or {@code steam:<SteamID>} for a player the backend knows only from a demo. {@code quality} is
 * {@code "720p"} or {@code "1080p"}; without one, in a body of {@code {"playerId": "..."}} as well as with
 * {@code "quality": null}, the compilation is recorded at 720p. {@code fps} is {@code 60}, {@code 120} or
 * {@code 240}, and 60 without one.
 */
public record CompilationRequest(
        @NotNull @Pattern(regexp = CompilationRequest.PLAYER_ID_PATTERN, message = CompilationRequest.PLAYER_ID_MESSAGE)
        String playerId,
        ClipQuality quality,
        ClipFps fps) {

    /**
     * The usual id of a player, or a provisional one: {@code steam:} and a SteamID of 1 to 20 digits. The usual pattern
     * is the one of the URL paths, whose ids have no colon; this id travels in a JSON body, and a clip of a highlight
     * can already be requested for a player who has only a provisional id (every player of a demo that FACEIT's roster
     * of the match does not name).
     */
    public static final String PLAYER_ID_PATTERN = PlayerController.PLAYER_ID_PATTERN + "|^steam:[0-9]{1,20}$";
    public static final String PLAYER_ID_MESSAGE =
            "must be a FACEIT player id (1-64 characters: letters, digits or '-') or steam:<SteamID>";

    public CompilationRequest {
        quality = quality == null ? ClipQuality.P720 : quality;
        fps = fps == null ? ClipFps.DEFAULT : fps;
    }
}
