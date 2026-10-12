package io.csfaceit.backend.clip.dto;

import java.time.Instant;

/**
 * Whether a recorder is there to take the clips that wait. {@code online} is true when some recorder was seen within
 * {@code clip.worker-online-within}; {@code lastSeenAt} is when the latest one was seen, {@code null} if none ever was.
 * {@code queued} clips wait for a recorder and {@code active} clips are held by one.
 */
public record RecorderStatusResponse(boolean online, Instant lastSeenAt, int queued, int active) {
}
