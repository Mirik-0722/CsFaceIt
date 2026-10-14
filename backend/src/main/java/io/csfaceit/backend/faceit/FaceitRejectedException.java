package io.csfaceit.backend.faceit;

/**
 * FACEIT refused the request with a 4xx other than 404 and 429 (typically 400, 401 or 403 for an unknown or revoked
 * API key). Repeating the identical request cannot succeed, so the gateway never retries it; callers and the cache's
 * stale fallback treat it like any other {@link FaceitUnavailableException}.
 */
public class FaceitRejectedException extends FaceitUnavailableException {

    private final int status;

    public FaceitRejectedException(String message) {
        this(message, 0);
    }

    /** @param status the HTTP status FACEIT answered with; 0 when it is not known */
    public FaceitRejectedException(String message, int status) {
        super(message);
        this.status = status;
    }

    /** The HTTP status FACEIT answered with; 0 when it is not known. */
    public int getStatus() {
        return status;
    }

    /** Whether the refusal says that the site's own key is wrong or revoked (401 or 403), not that the request is. */
    public boolean isCredentialRefusal() {
        return status == 401 || status == 403;
    }
}
