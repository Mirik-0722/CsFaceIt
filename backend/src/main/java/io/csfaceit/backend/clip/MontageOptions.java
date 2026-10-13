package io.csfaceit.backend.clip;

/**
 * What a montage is recorded with besides its segments, as {@code clips.options} holds it: the {@code title} written
 * over the video ({@code null} for none), the shape of the picture, whether a card with the title opens the video for
 * {@link #INTRO_SECONDS}, and the id of a track of {@code clip.music-tracks} to lay under it ({@code null} for none).
 * The segments, with their slow motion, are in {@code clips.segments} like those of every clip.
 */
public record MontageOptions(String title, ClipAspect aspect, boolean intro, String musicTrack) {

    /** How long the intro card lasts, in seconds of the video. */
    public static final int INTRO_SECONDS = 2;

    public MontageOptions {
        aspect = aspect == null ? ClipAspect.LANDSCAPE : aspect;
    }

    /** How many ticks of the demo the intro adds to the length of the video at {@code tickRate}: none without one. */
    public long introTicks(int tickRate) {
        return intro ? (long) INTRO_SECONDS * tickRate : 0;
    }
}
