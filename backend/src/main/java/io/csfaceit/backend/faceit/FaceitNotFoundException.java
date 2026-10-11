package io.csfaceit.backend.faceit;

/** FACEIT answered 404: the requested player or match does not exist. Never retried. */
public class FaceitNotFoundException extends RuntimeException {

    public FaceitNotFoundException(String message) {
        super(message);
    }
}
