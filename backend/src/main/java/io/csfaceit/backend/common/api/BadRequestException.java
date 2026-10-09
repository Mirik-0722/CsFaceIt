package io.csfaceit.backend.common.api;

/** The request itself is wrong (a file of the wrong kind, a part that is missing); the answer is 400 {@code VALIDATION_ERROR}. */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
