package io.csfaceit.backend.auth;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.util.Optional;
import org.springframework.http.ResponseCookie;

/**
 * The two cookies of signing in, in one place so that their attributes cannot drift apart. Neither can be read by a
 * script ({@code HttpOnly}), neither goes along with a request made from another site except the plain navigation
 * that Steam's redirect is ({@code SameSite=Lax}), and both are {@code Secure} when the browser is on HTTPS (see
 * {@link RequestOrigin}). Clearing a cookie repeats the attributes it was set with, which is what makes a browser
 * replace it.
 *
 * <ul>
 *   <li>{@code csf_session} holds the token of the session, for the whole site, for as long as the session lasts.
 *   <li>{@code csf_login} holds a {@link LoginState} for ten minutes and travels only to {@code /api/v1/auth}, where
 *       the callback that needs it is.
 * </ul>
 */
final class AuthCookies {

    static final String SESSION = "csf_session";
    static final String LOGIN = "csf_login";

    private static final String SESSION_PATH = "/";
    private static final String LOGIN_PATH = "/api/v1/auth";
    private static final Duration LOGIN_LIFETIME = Duration.ofMinutes(10);
    private static final String SAME_SITE = "Lax";

    private AuthCookies() {
    }

    static ResponseCookie session(String token, Duration lifetime, boolean secure) {
        return builder(SESSION, token, SESSION_PATH, secure).maxAge(lifetime).build();
    }

    static ResponseCookie clearedSession(boolean secure) {
        return builder(SESSION, "", SESSION_PATH, secure).maxAge(Duration.ZERO).build();
    }

    static ResponseCookie login(LoginState login, boolean secure) {
        return builder(LOGIN, login.encode(), LOGIN_PATH, secure).maxAge(LOGIN_LIFETIME).build();
    }

    static ResponseCookie clearedLogin(boolean secure) {
        return builder(LOGIN, "", LOGIN_PATH, secure).maxAge(Duration.ZERO).build();
    }

    /** The token in the {@code csf_session} cookie of the request, if it has one. Nothing says it is a live session. */
    static Optional<String> sessionToken(HttpServletRequest request) {
        return valueOf(request, SESSION);
    }

    /** The sign-in under way that the request's {@code csf_login} cookie holds, if it has a well-formed one. */
    static Optional<LoginState> loginState(HttpServletRequest request) {
        return valueOf(request, LOGIN).flatMap(LoginState::decode);
    }

    private static ResponseCookie.ResponseCookieBuilder builder(String name, String value, String path, boolean secure) {
        return ResponseCookie.from(name, value)
                .httpOnly(true)
                .secure(secure)
                .sameSite(SAME_SITE)
                .path(path);
    }

    private static Optional<String> valueOf(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return Optional.empty();
        }
        for (Cookie cookie : cookies) {
            if (name.equals(cookie.getName())) {
                return Optional.of(cookie.getValue());
            }
        }
        return Optional.empty();
    }
}
