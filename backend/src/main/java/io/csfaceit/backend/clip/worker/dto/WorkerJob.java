package io.csfaceit.backend.clip.worker.dto;

import io.csfaceit.backend.clip.ClipKind;
import io.csfaceit.backend.clip.ClipSegment;
import io.csfaceit.backend.clip.MontageOptions;
import java.util.List;

/**
 * The clip a recorder has taken, with everything it needs to record it. The demo is fetched from
 * {@code GET /api/worker/v1/clips/{clipId}/demo}; it is {@code demoSizeBytes} long, and {@code demoVersion} names this
 * version of the file (the demo's last change in epoch milliseconds, as a string), so a recorder that keeps demos may
 * keep one under that name and use it for the next clip of the same match. The video is the {@code segments} one after
 * the other, in ticks of the demo (which runs at {@code tickRate} per second), seen as {@code focusSteamId} and
 * recorded at {@code width} x {@code height} and {@code fps}.
 *
 * <p>A {@code MONTAGE} brings its options: a segment with {@code slowMo} is played at half speed (it lasts twice as
 * long in the video), {@code title} is written over the video ({@code null} for none), {@code intro} opens it with a
 * card of {@link MontageOptions#INTRO_SECONDS} seconds that shows the title, {@code musicTrack} is the id of a track of
 * {@code clip.music-tracks} ({@code null} for none), and {@code aspect} is {@code "16:9"} or {@code "9:16"} (the
 * width and height are already the shape's). For every other kind they are {@code null}, {@code false} and
 * {@code null}, and every segment's {@code slowMo} is {@code false}.
 */
public record WorkerJob(
        long clipId,
        ClipKind kind,
        String matchId,
        String mapName,
        String focusSteamId,
        int tickRate,
        List<ClipSegment> segments,
        int width,
        int height,
        int fps,
        long demoSizeBytes,
        String demoVersion,
        String title,
        boolean intro,
        String musicTrack,
        String aspect) {

    /** The job of a clip with what its options say, none for a clip that is no montage. */
    public static WorkerJob of(long clipId, ClipKind kind, String matchId, String mapName, String focusSteamId,
                               int tickRate, List<ClipSegment> segments, int width, int height, int fps,
                               long demoSizeBytes, String demoVersion, MontageOptions options) {
        return new WorkerJob(clipId, kind, matchId, mapName, focusSteamId, tickRate, segments, width, height, fps,
                demoSizeBytes, demoVersion, options == null ? null : options.title(),
                options != null && options.intro(), options == null ? null : options.musicTrack(),
                options == null ? null : options.aspect().label());
    }
}
