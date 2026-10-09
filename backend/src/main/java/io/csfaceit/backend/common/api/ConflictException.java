package io.csfaceit.backend.common.api;

/** The request is valid but cannot be carried out in the current state; {@code code} says why. */
public class ConflictException extends RuntimeException {

    private final String code;

    public ConflictException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
