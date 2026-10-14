package io.csfaceit.backend.faceit;

/**
 * FACEIT refused the request with a 4xx other than 404 and 429 (typically 400 {@code invalid_token}, 401 or 403 for
 * an unknown or revoked API key). Repeating the identical request cannot succeed, so the gateway never retries it; the
 * cache's stale fallback and most callers treat it like any other {@link FaceitUnavailableException}. The sync's sweep
 * of lost imports tells a refused key ({@link #isCredentialRefusal}) from a refused request.
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

    /**
     * Whether the refusal may say that the site's own key is wrong or revoked rather than that the request is: 401 or
     * 403, and 400, which is what FACEIT answers an unknown key with ({@code invalid_token}).
     */
    public boolean isCredentialRefusal() {
        return status == 400 || status == 401 || status == 403;
    }
}
