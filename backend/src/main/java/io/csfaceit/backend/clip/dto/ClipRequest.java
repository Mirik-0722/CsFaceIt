package io.csfaceit.backend.clip.dto;

import io.csfaceit.backend.clip.ClipFps;
import io.csfaceit.backend.clip.ClipQuality;

/**
 * The body of a request for a clip. {@code quality} is {@code "720p"} or {@code "1080p"}; without one, in a body
 * of {@code {}} as well as in no body at all, the clip is recorded at 720p. {@code fps} is {@code 60}, {@code 120} or
 * {@code 240}, and 60 without one.
 */
public record ClipRequest(ClipQuality quality, ClipFps fps) {

    public ClipRequest {
        quality = quality == null ? ClipQuality.P720 : quality;
        fps = fps == null ? ClipFps.DEFAULT : fps;
    }
}
