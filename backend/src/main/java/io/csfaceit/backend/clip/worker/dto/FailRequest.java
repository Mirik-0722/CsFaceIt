package io.csfaceit.backend.clip.worker.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * A recorder giving up its attempt. {@code error} says why (it is kept, cut to a sane length, and shown to whoever
 * looks at the clip). {@code retryable} says that another attempt may do better, for instance after the game crashed;
 * the clip then goes back to the queue unless it has had all its attempts.
 */
public record FailRequest(
        @NotBlank @Size(max = WorkerLimits.NAME) String worker,
        String error,
        boolean retryable) {
}
