package io.csfaceit.backend.clip.worker.dto;

import io.csfaceit.backend.clip.ClipQuality;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * A recorder asking for work. {@code worker} is its name, which stands in {@code clips.claimed_by} while it holds a
 * clip. {@code version} and {@code mode} describe the recorder (they are shown to nobody but the operator). All three
 * are plain words (see {@link WorkerLimits}). {@code qualities} are the qualities it can record; without any (null or
 * empty) every quality is meant.
 */
public record ClaimRequest(
        @WorkerName String worker,
        @Size(max = WorkerLimits.VERSION) @Pattern(regexp = WorkerLimits.PLAIN, message = WorkerLimits.PLAIN_MESSAGE)
        String version,
        @Size(max = WorkerLimits.MODE) @Pattern(regexp = WorkerLimits.PLAIN, message = WorkerLimits.PLAIN_MESSAGE)
        String mode,
        List<@NotNull ClipQuality> qualities) {
}
