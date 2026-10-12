package io.csfaceit.backend.clip.worker.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * A recorder saying that it is there, for the status of the recorder shown to everyone. {@code state} is
 * {@code IDLE} or {@code WORKING}; {@code clipId} is the clip it works on, if it does. It does not keep a clip alive:
 * that is what the progress reports are for.
 */
public record HeartbeatRequest(
        @NotBlank @Size(max = WorkerLimits.NAME) String worker,
        @Size(max = WorkerLimits.VERSION) String version,
        @Size(max = WorkerLimits.MODE) String mode,
        @NotNull @Pattern(regexp = "IDLE|WORKING", message = "must be IDLE or WORKING") String state,
        Long clipId) {
}
