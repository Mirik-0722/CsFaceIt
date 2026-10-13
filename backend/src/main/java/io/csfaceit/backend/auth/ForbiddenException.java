package io.csfaceit.backend.auth;

/**
 * The request is authenticated, but the rules of {@link Access} do not let its actor do this; {@code code} says which
 * rule. It is answered 403 with the usual error body.
 */
public class ForbiddenException extends RuntimeException {

    private final String code;

    public ForbiddenException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
