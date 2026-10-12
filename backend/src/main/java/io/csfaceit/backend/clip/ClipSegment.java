package io.csfaceit.backend.clip;

/**
 * One stretch of the demo that a clip is made of, in ticks of the demo, both ends included. The video is the segments
 * of the clip one after the other, in the order of the list.
 */
public record ClipSegment(int startTick, int endTick) {
}
