package io.csfaceit.backend.clip.worker.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/** A recorder's word that the video it uploaded is finished: its length and the size of its picture. */
public record CompleteRequest(
        @NotBlank @Size(max = WorkerLimits.NAME) String worker,
        @Positive int durationMs,
        @Positive int width,
        @Positive int height) {
}
