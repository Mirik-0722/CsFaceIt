package io.csfaceit.backend.clip;

import com.fasterxml.jackson.annotation.JsonIgnore;

/**
 * One stretch of the demo that a clip is made of, in ticks of the demo, both ends included. The video is the segments
 * of the clip one after the other, in the order of the list.
 *
 * <p>{@code slowMo} is set only in a montage, whose player asked for the stretch at half speed: it then lasts twice as
 * long in the video. A segment stored without the field (every clip from before montages, and every highlight clip and
 * compilation) is read with {@code false}.
 */
public record ClipSegment(int startTick, int endTick, boolean slowMo) {

    /** How many times longer a slow-motion segment lasts in the video than in the demo. */
    public static final int SLOW_MO_FACTOR = 2;

    /** A segment at normal speed, as the clips of a highlight and the compilations are made of. */
    public ClipSegment(int startTick, int endTick) {
        this(startTick, endTick, false);
    }

    /** The length of the segment in the demo, in ticks. Not part of the JSON, which holds the three fields only. */
    @JsonIgnore
    public long ticks() {
        return (long) endTick - startTick;
    }

    /** The length of the segment in the video, in ticks of the demo: twice its length when it is slowed down. */
    @JsonIgnore
    public long videoTicks() {
        return slowMo ? ticks() * SLOW_MO_FACTOR : ticks();
    }
}
