package io.csfaceit.backend.common.api;

/**
 * The request is for someone who is signed in, and nobody is; the answer is 401 {@code UNAUTHENTICATED}. It is not the
 * {@code UNAUTHORIZED} of a request that lacks the admin key or the worker token, which the security filter chain
 * answers: this one is the application saying that there is no session, to a visitor who is allowed to ask.
 */
public class UnauthenticatedException extends RuntimeException {

    public UnauthenticatedException(String message) {
        super(message);
    }
}
