package io.csfaceit.backend.clip.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.List;

/**
 * The body of the order of a montage. {@code playerId} is required, as for a compilation: the FACEIT player id or
 * {@code steam:<SteamID>}. The rest is checked by {@code ClipService}, which answers what is wrong with a code of its
 * own rather than with a {@code VALIDATION_ERROR}:
 * <ul>
 *   <li>{@code quality} is {@code "720p"} or {@code "1080p"}, 720p when it is missing; {@code aspect} is
 *       {@code "16:9"} or {@code "9:16"}, 16:9 when it is missing; {@code title} is up to 60 characters, none when it
 *       is missing or blank; {@code musicTrack} is the id of one of {@code clip.music-tracks}, none when it is missing.
 *       Anything else is a 400 {@code INVALID_MONTAGE_OPTION}.
 *   <li>{@code segments} are the stretches of the demo the video is made of, in the order given (they are neither
 *       sorted nor merged): 1 to 30 of them, each with {@code startTick < endTick}. Otherwise a 400
 *       {@code INVALID_SEGMENTS}.
 * </ul>
 */
public record MontageRequest(
        @NotNull @Pattern(regexp = CompilationRequest.PLAYER_ID_PATTERN, message = CompilationRequest.PLAYER_ID_MESSAGE)
        String playerId,
        String quality,
        String aspect,
        String title,
        boolean intro,
        String musicTrack,
        List<Segment> segments) {

    /** One stretch of the demo, in ticks, both ends included; {@code slowMo} plays it at half speed. */
    public record Segment(Integer startTick, Integer endTick, boolean slowMo) {
    }
}
