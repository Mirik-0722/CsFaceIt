package io.csfaceit.backend.auth;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * What the site remembers of a sign-in that is under way, in the {@code csf_login} cookie of the browser that started
 * it: a random {@code state} and the path to go back to. The same {@code state} travels in the address Steam sends the
 * visitor back to, and the callback accepts the visitor only if the two are equal. That ties the answer to the browser
 * that asked for it, so an address with somebody else's answer in it, given to a visitor, signs nobody in as that
 * somebody (the attack called login CSRF).
 *
 * <p>The cookie value is {@code <state>.<return path>}, the path as URL-safe Base64 so that it holds nothing a cookie
 * cannot. The {@code state} is a secret for as long as the sign-in lasts, so {@link #toString} hides it.
 *
 * @param state 32 random bytes as URL-safe Base64 without padding (43 characters)
 * @param returnTo a path of this site, already checked by {@link ReturnPath}
 */
record LoginState(String state, String returnTo) {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int STATE_BYTES = 32;
    private static final Pattern STATE_SHAPE = Pattern.compile("[A-Za-z0-9_-]{43}");

    /** A new sign-in: a fresh {@code state}, and the path the visitor asked to return to if it is one of this site. */
    static LoginState begin(String requestedReturnTo) {
        byte[] bytes = new byte[STATE_BYTES];
        RANDOM.nextBytes(bytes);
        String state = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        return new LoginState(state, ReturnPath.sanitize(requestedReturnTo));
    }

    /**
     * The value of the cookie that has this state, or empty when the value is not one that {@link #encode} made. The
     * path is checked again: the cookie is the browser's, so what comes back is not trusted for having been sent out.
     */
    static Optional<LoginState> decode(String cookieValue) {
        if (cookieValue == null) {
            return Optional.empty();
        }
        int dot = cookieValue.indexOf('.');
        if (dot < 0) {
            return Optional.empty();
        }
        String state = cookieValue.substring(0, dot);
        if (!STATE_SHAPE.matcher(state).matches()) {
            return Optional.empty();
        }
        try {
            String path = new String(Base64.getUrlDecoder().decode(cookieValue.substring(dot + 1)), UTF_8);
            return Optional.of(new LoginState(state, ReturnPath.sanitize(path)));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    /** The cookie value. */
    String encode() {
        return state + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(returnTo.getBytes(UTF_8));
    }

    /** Whether the state the callback came with is this one. Compared in constant time. */
    boolean stateMatches(String presented) {
        return presented != null && MessageDigest.isEqual(state.getBytes(UTF_8), presented.getBytes(UTF_8));
    }

    /** Keeps the state out of logs. */
    @Override
    public String toString() {
        return "LoginState[state=***, returnTo=" + returnTo + "]";
    }
}
