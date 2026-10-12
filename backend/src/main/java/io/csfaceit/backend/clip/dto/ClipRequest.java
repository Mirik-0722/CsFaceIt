package io.csfaceit.backend.clip.dto;

import io.csfaceit.backend.clip.ClipQuality;

/**
 * The body of a request for a clip. {@code quality} is {@code "720p"} or {@code "1080p"}; without one, in a body
 * of {@code {}} as well as in no body at all, the clip is recorded at 720p.
 */
public record ClipRequest(ClipQuality quality) {

    public ClipRequest {
        quality = quality == null ? ClipQuality.P720 : quality;
    }
}
