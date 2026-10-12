package io.csfaceit.backend.clip;

import java.util.ArrayList;
import java.util.List;

/**
 * Decides which stretches of a demo a clip is made of. Every kill of the player gets a segment of its own, from
 * {@code clip.pre-seconds} before the kill to {@code clip.post-seconds} after it, cut to the window the clip must stay
 * in (the highlight's window, or the round for a compilation). Segments that are less than
 * {@code clip.merge-gap-seconds} apart, and those that overlap, become one, so that kills in quick succession are one
 * continuous stretch and no footage is shown twice. A window with no kill in it is shown whole. Pure arithmetic on
 * ticks: nothing is read or written here.
 */
public final class SegmentBuilder {

    private SegmentBuilder() {
    }

    /**
     * The segments of a clip, in the order of the demo.
     *
     * @param killTicks the ticks of the player's kills of an enemy inside the window; a tick outside it is no kill of
     *        this window and is ignored
     * @param windowStart the first tick the clip may show
     * @param windowEnd the last tick the clip may show
     * @param tickRate the ticks per second of the demo, which turns the seconds of the settings into ticks
     * @param properties the {@code clip.*} settings the lengths come from
     * @return at least one segment, none empty or outside the window; the window itself when there is no kill
     */
    public static List<ClipSegment> build(List<Integer> killTicks, int windowStart, int windowEnd, int tickRate,
                                          ClipProperties properties) {
        int preTicks = properties.preSeconds() * tickRate;
        int postTicks = properties.postSeconds() * tickRate;
        int mergeGapTicks = properties.mergeGapSeconds() * tickRate;

        List<Integer> ticks = killTicks.stream()
                .filter(tick -> tick >= windowStart && tick <= windowEnd)
                .sorted()
                .toList();
        List<ClipSegment> segments = new ArrayList<>();
        for (int tick : ticks) {
            int start = Math.max(windowStart, tick - preTicks);
            int end = Math.min(windowEnd, tick + postTicks);
            int last = segments.size() - 1;
            if (last >= 0 && start - segments.get(last).endTick() < mergeGapTicks) {
                ClipSegment previous = segments.get(last);
                segments.set(last, new ClipSegment(previous.startTick(), Math.max(previous.endTick(), end)));
            } else {
                segments.add(new ClipSegment(start, end));
            }
        }
        return segments.isEmpty() ? List.of(new ClipSegment(windowStart, windowEnd)) : List.copyOf(segments);
    }

    /** The length of the video the segments make together, in ticks. */
    public static long totalTicks(List<ClipSegment> segments) {
        return segments.stream().mapToLong(segment -> (long) segment.endTick() - segment.startTick()).sum();
    }
}
