package io.csfaceit.backend.common.api;

/**
 * The request is valid but the service takes no more of that work for now, and asking again later may succeed;
 * {@code code} says which limit was reached (for example {@code CLIP_QUEUE_FULL}). The answer is 429.
 */
public class TooManyRequestsException extends RuntimeException {

    private final String code;

    public TooManyRequestsException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
