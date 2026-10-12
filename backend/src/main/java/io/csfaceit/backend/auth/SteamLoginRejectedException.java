package io.csfaceit.backend.auth;

/**
 * A sign-in with Steam that must not go on: the answer was not genuine, was not for this site, or could not be
 * confirmed. It is an expected outcome, not a fault, so it carries no stack trace; its message is the reason, in words
 * that hold no value from the request (not a parameter, not the state), because the caller writes it to the log.
 */
class SteamLoginRejectedException extends RuntimeException {

    SteamLoginRejectedException(String reason) {
        super(reason, null, false, false);
    }
}
