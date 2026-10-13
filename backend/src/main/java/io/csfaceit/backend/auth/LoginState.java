package io.csfaceit.backend.auth;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * What the site remembers of a sign-in that is under way, in the {@code csf_login} cookie of the browser that started
 * it: a random {@code verifier} and the path to go back to. The address Steam sends the visitor back to carries the
 * {@code state}, which is the SHA-256 of the verifier, and the callback accepts the visitor only if it recomputes that
 * hash from its own cookie and finds it equal to the {@code state} of the address. That ties the answer to the browser
 * that asked for it, so an address with somebody else's answer in it, given to a visitor, signs nobody in as that
 * somebody (the attack called login CSRF).
 *
 * <p>The verifier is what makes the binding real. The {@code state} is in an address, and an address is seen by more
 * than the browser (the access log of the proxy, a referrer, a shared link). Were the cookie to hold the {@code state}
 * itself, whoever saw the address could rebuild the cookie. The hash cannot be turned back into the verifier, so seeing
 * the address is not enough. This is the construction of PKCE (RFC 7636, the method {@code S256}), with the hash taken
 * of the text of the verifier as it stands in the cookie.
 *
 * <p>The cookie value is {@code <verifier>.<return path>}, the path as URL-safe Base64 so that it holds nothing a cookie
 * cannot. The verifier never appears in an address, a log line or an answer: it is in the cookie and in memory for the
 * length of the callback, and {@link #toString} hides it.
 *
 * @param verifier 32 random bytes as URL-safe Base64 without padding (43 characters)
 * @param returnTo a path of this site, already checked by {@link ReturnPath}
 */
record LoginState(String verifier, String returnTo) {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int VERIFIER_BYTES = 32;
    private static final Pattern VERIFIER_SHAPE = Pattern.compile("[A-Za-z0-9_-]{43}");

    /** A new sign-in: a fresh verifier, and the path the visitor asked to return to if it is one of this site. */
    static LoginState begin(String requestedReturnTo) {
        byte[] bytes = new byte[VERIFIER_BYTES];
        RANDOM.nextBytes(bytes);
        String verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        return new LoginState(verifier, ReturnPath.sanitize(requestedReturnTo));
    }

    /**
     * The sign-in that the value of a cookie holds, or empty when the value is not one that {@link #encode} made. The
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
        String verifier = cookieValue.substring(0, dot);
        if (!VERIFIER_SHAPE.matcher(verifier).matches()) {
            return Optional.empty();
        }
        try {
            String path = new String(Base64.getUrlDecoder().decode(cookieValue.substring(dot + 1)), UTF_8);
            return Optional.of(new LoginState(verifier, ReturnPath.sanitize(path)));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    /** The cookie value. */
    String encode() {
        return verifier + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(returnTo.getBytes(UTF_8));
    }

    /**
     * The {@code state} of this sign-in, which goes into the address Steam sends the visitor back to: the SHA-256 of the
     * verifier as URL-safe Base64 without padding (43 characters).
     */
    String state() {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            // Every Java runtime has SHA-256.
            throw new IllegalStateException(e);
        }
    }

    /** Whether the state the callback came with is the one of this verifier. Compared in constant time. */
    boolean stateMatches(String presented) {
        return presented != null && MessageDigest.isEqual(state().getBytes(UTF_8), presented.getBytes(UTF_8));
    }

    /** Keeps the verifier out of logs. */
    @Override
    public String toString() {
        return "LoginState[verifier=***, returnTo=" + returnTo + "]";
    }
}
