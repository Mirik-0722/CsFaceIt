package io.csfaceit.backend.clip.worker.dto;

/**
 * A recorder giving up its attempt. {@code error} says why. It is kept, cut to a sane length, and shown to whoever
 * looks at the clip, since the API of clips is public: it should hold no local path and no stack trace.
 * {@code retryable} says that another attempt may do better, for instance after the game crashed; the clip then goes
 * back to the queue unless it has had all its attempts.
 */
public record FailRequest(
        @WorkerName String worker,
        String error,
        boolean retryable) {
}
