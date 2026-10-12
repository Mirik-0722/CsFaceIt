package io.csfaceit.backend.common.api;

/**
 * A request asked for bytes the resource does not have: a {@code Range} that starts at or beyond its end. The answer is
 * 416, and its {@code Content-Range} header names the length of the resource, so that the client can ask again.
 */
public class RangeNotSatisfiableException extends RuntimeException {

    private final long sizeBytes;

    public RangeNotSatisfiableException(long sizeBytes, String message) {
        super(message);
        this.sizeBytes = sizeBytes;
    }

    /** The length of the resource in bytes. */
    public long getSizeBytes() {
        return sizeBytes;
    }
}
