package io.csfaceit.backend.clip.dto;

import io.csfaceit.backend.clip.ClipAspect;
import io.csfaceit.backend.clip.ClipSegment;
import java.util.List;

/**
 * What a montage was ordered with, as {@link ClipResponse#montage} shows it: the title ({@code null} for none), the
 * shape of the picture ({@code "16:9"} or {@code "9:16"}), whether an intro card opens it, the id of its music
 * ({@code null} for none), and its segments in the order of the video, each {@code {startTick, endTick, slowMo}}.
 */
public record MontageResponse(String title, ClipAspect aspect, boolean intro, String musicTrack,
                              List<ClipSegment> segments) {
}
