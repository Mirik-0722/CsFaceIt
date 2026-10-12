package io.csfaceit.backend.clip;

/**
 * Where a clip is in the chain from the request to the video: {@code QUEUED}, then {@code RECORDING}, {@code ENCODING}
 * and {@code UPLOADING} while a recorder works on it, then {@code DONE}. The three in the middle are the active
 * statuses ({@link #isActive}). From an active status a clip goes on to {@code FAILED}, or back to {@code QUEUED} to be
 * recorded again; {@code DONE} and {@code FAILED} are final. See {@link Clip} for the transitions.
 */
public enum ClipStatus {
    QUEUED,
    RECORDING,
    ENCODING,
    UPLOADING,
    DONE,
    FAILED;

    /** Whether a recorder holds the clip: it is being recorded, encoded or uploaded. */
    public boolean isActive() {
        return this == RECORDING || this == ENCODING || this == UPLOADING;
    }
}
