package io.csfaceit.backend.common.api;

/**
 * A resource that was there is not any more, and will not come back by itself; {@code code} says which one (for
 * example {@code DEMO_NOT_AVAILABLE}). The answer is 410.
 */
public class GoneException extends RuntimeException {

    private final String code;

    public GoneException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
