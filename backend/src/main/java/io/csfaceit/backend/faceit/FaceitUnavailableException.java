package io.csfaceit.backend.faceit;

/**
 * FACEIT could not serve the request: 429, 5xx, a rejected API key (401/403) or a connection failure. Retried by
 * the gateway; callers only see it once all attempts are used up.
 */
public class FaceitUnavailableException extends RuntimeException {

    public FaceitUnavailableException(String message) {
        super(message);
    }

    public FaceitUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
