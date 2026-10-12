package io.csfaceit.backend.clip.worker.dto;

import io.csfaceit.backend.clip.ClipStatus;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/**
 * A recorder's report on the clip it holds: the stage it is in ({@code RECORDING}, {@code ENCODING} or
 * {@code UPLOADING}; the service refuses any other) and the percent of the attempt done. It is also the sign of life
 * that keeps the clip from being taken back.
 */
public record ProgressRequest(
        @WorkerName String worker,
        @NotNull ClipStatus stage,
        @Min(0) @Max(100) int progress) {
}
