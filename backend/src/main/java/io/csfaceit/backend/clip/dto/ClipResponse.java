package io.csfaceit.backend.clip.dto;

import io.csfaceit.backend.analysis.highlight.HighlightType;
import io.csfaceit.backend.clip.ClipKind;
import io.csfaceit.backend.clip.ClipQuality;
import io.csfaceit.backend.clip.ClipStatus;
import java.time.Instant;
import java.util.List;

/**
 * A clip and where it is on its way to a video.
 *
 * <p>{@code matchId} is the FACEIT match id and {@code playerId} the FACEIT player id ({@code steam:<SteamID>} for a
 * player the backend knows only from a demo). {@code highlightType}, {@code roundNumber} and {@code tickStart} name
 * the highlight of a clip of one highlight and are {@code null} in a compilation. {@code progress} is the percent
 * done of the attempt that is running. {@code error} says why the clip failed, or why its last attempt did while it
 * waits to be recorded again.
 *
 * <p>{@code queuePosition} counts from 1 and is set only while the clip is {@code QUEUED}. {@code videoUrl},
 * {@code thumbnailUrl} and {@code expiresAt} are set only once the clip is {@code DONE} (the thumbnail only if the
 * recorder uploaded one); {@code expiresAt} is when the clean-up of old clips will remove it, and {@code null} when
 * clips are kept forever. {@code durationMs} is the length of the finished video and {@code sizeBytes} the size of its
 * file, which is known from the upload on; {@code finishedAt} is when the clip became {@code DONE} or {@code FAILED}.
 * {@code kills} are the kills the video shows, on its timeline; only the answer for one clip carries them, in every
 * list and in the answer to a request for a clip the array is empty.
 */
public record ClipResponse(
        long id,
        ClipKind kind,
        ClipStatus status,
        int progress,
        String matchId,
        String mapName,
        String playerId,
        String nickname,
        HighlightType highlightType,
        Integer roundNumber,
        Integer tickStart,
        ClipQuality quality,
        int fps,
        Integer durationMs,
        Long sizeBytes,
        String error,
        Integer queuePosition,
        String videoUrl,
        String thumbnailUrl,
        Instant createdAt,
        Instant finishedAt,
        Instant expiresAt,
        List<ClipKill> kills) {
}
