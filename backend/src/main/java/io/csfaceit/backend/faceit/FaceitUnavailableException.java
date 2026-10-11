package io.csfaceit.backend.faceit;

/**
 * FACEIT could not serve the request: 429, 5xx, an empty body, a connection failure or a rejected request
 * ({@link FaceitRejectedException}). The gateway retries all of these except a rejected request; callers only see
 * it once all attempts are used up.
 */
public class FaceitUnavailableException extends RuntimeException {

    public FaceitUnavailableException(String message) {
        super(message);
    }

    public FaceitUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
