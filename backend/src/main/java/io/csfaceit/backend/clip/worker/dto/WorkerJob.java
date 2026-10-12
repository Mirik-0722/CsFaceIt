package io.csfaceit.backend.clip.worker.dto;

import io.csfaceit.backend.clip.ClipKind;
import io.csfaceit.backend.clip.ClipSegment;
import java.util.List;

/**
 * The clip a recorder has taken, with everything it needs to record it. The demo is fetched from
 * {@code GET /api/worker/v1/clips/{clipId}/demo}; it is {@code demoSizeBytes} long, and {@code demoVersion} names this
 * version of the file (the demo's last change in epoch milliseconds, as a string), so a recorder that keeps demos may
 * keep one under that name and use it for the next clip of the same match. The video is the {@code segments} one after
 * the other, in ticks of the demo (which runs at {@code tickRate} per second), seen as {@code focusSteamId} and
 * recorded at {@code width} x {@code height} and {@code fps}.
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
        String demoVersion) {
}
