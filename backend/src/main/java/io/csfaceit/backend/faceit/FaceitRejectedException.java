package io.csfaceit.backend.faceit;

/**
 * FACEIT refused the request with a 4xx other than 404 and 429 (typically 400, 401 or 403 for an unknown or revoked
 * API key). Repeating the identical request cannot succeed, so the gateway never retries it; callers and the cache's
 * stale fallback treat it like any other {@link FaceitUnavailableException}.
 */
public class FaceitRejectedException extends FaceitUnavailableException {

    public FaceitRejectedException(String message) {
        super(message);
    }
}
