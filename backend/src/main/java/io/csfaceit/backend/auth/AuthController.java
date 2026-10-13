package io.csfaceit.backend.auth;

import io.csfaceit.backend.auth.SessionService.NewSession;
import io.csfaceit.backend.auth.dto.MeResponse;
import io.csfaceit.backend.auth.dto.ProvidersResponse;
import io.csfaceit.backend.common.api.BadRequestException;
import io.csfaceit.backend.common.api.NotFoundException;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Signing in and out, and who is signed in. Everything here is open to every visitor: a visitor who is not signed in
 * gets the answers below, not the 401 of the filter chain (see {@code SecurityConfig}). A session identifies the
 * visitor and gives no access to the requests that need the admin key.
 *
 * <p>The sign-in with Steam is two requests of the browser's own, which is why they are {@code GET}s that answer with
 * redirects and not calls of the interface. {@code start} sends the visitor to Steam and leaves the {@code csf_login}
 * cookie (see {@link LoginState}); {@code callback} is where Steam sends them back, and it makes a session of the
 * answer only if all the checks of {@link SteamOpenId} pass, in which case the visitor goes on to the page they asked
 * for. Whatever goes wrong, the visitor ends on {@code /?login=failed} with the one line in the log that says why, never
 * on an error page. The {@code csf_login} cookie is spent either way.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private static final String LOGIN_FAILED = "/?login=failed";
    private static final String AUTH_PROVIDER_DISABLED = "AUTH_PROVIDER_DISABLED";

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final AuthProperties properties;
    private final SteamOpenId steam;
    private final SignInService signIn;
    private final SessionService sessions;

    public AuthController(AuthProperties properties, SteamOpenId steam, SignInService signIn,
                          SessionService sessions) {
        this.properties = properties;
        this.steam = steam;
        this.signIn = signIn;
        this.sessions = sessions;
    }

    /**
     * Which ways of signing in are offered. FACEIT is reported off whatever the settings say: its two endpoints below
     * always answer as for a provider that is off, so a client id alone must not make the site show a live button that
     * leads to an error. What turns it on is the flow itself (plan 6a, Task C): then this answers
     * {@code properties.faceit().enabled()}, which is already read from {@code FACEIT_OAUTH_CLIENT_ID}.
     */
    @GetMapping("/providers")
    public ProvidersResponse providers() {
        return new ProvidersResponse(true, false);
    }

    /**
     * Sends the visitor to Steam. {@code returnTo} is the path of the site to come back to; anything that is not a path
     * of this site is replaced by {@code /} (see {@link ReturnPath}).
     */
    @GetMapping("/steam/start")
    public ResponseEntity<Void> startSteam(@RequestParam(required = false) String returnTo,
                                           HttpServletRequest request) {
        RequestOrigin origin = RequestOrigin.of(request)
                .orElseThrow(() -> new BadRequestException("The Host header of the request cannot be used"));
        LoginState login = LoginState.begin(returnTo);
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(steam.loginRedirect(origin, login.state()))
                .header(HttpHeaders.SET_COOKIE, AuthCookies.login(login, origin.secure()).toString())
                .build();
    }

    /**
     * Where Steam sends the visitor back. On success: the {@code csf_session} cookie and a redirect to the path the
     * sign-in began from. On any refusal: a redirect to {@code /?login=failed} and a WARN line naming the reason, which
     * holds no value of the request. The database is not part of the refusals: a failure of it is a 500 as anywhere.
     */
    @GetMapping("/steam/callback")
    public ResponseEntity<Void> steamCallback(HttpServletRequest request) {
        boolean secure = RequestOrigin.isHttps(request);
        ResponseEntity.BodyBuilder redirect = ResponseEntity.status(HttpStatus.FOUND)
                .header(HttpHeaders.SET_COOKIE, AuthCookies.clearedLogin(secure).toString());
        try {
            RequestOrigin origin = RequestOrigin.of(request)
                    .orElseThrow(() -> new SteamLoginRejectedException("the Host header cannot be used"));
            LoginState login = AuthCookies.loginState(request).orElseThrow(() -> new SteamLoginRejectedException(
                    "this browser has no sign-in under way (no usable csf_login cookie)"));
            String[] states = request.getParameterValues("state");
            if (states == null || states.length != 1 || !login.stateMatches(states[0])) {
                throw new SteamLoginRejectedException("the state is not the one of the csf_login cookie");
            }

            String steamId = steam.verify(request.getParameterMap(), origin, login.state());
            User user = signIn.signInWithSteam(steamId);
            // A browser that signs in again ends the session it had, so that no old one is left behind for it.
            AuthCookies.sessionToken(request).ifPresent(sessions::delete);
            NewSession session = sessions.create(user.getId());
            return redirect
                    .header(HttpHeaders.SET_COOKIE,
                            AuthCookies.session(session.token(), properties.sessionLifetime(), secure).toString())
                    .location(URI.create(login.returnTo()))
                    .build();
        } catch (SteamLoginRejectedException e) {
            log.warn("Sign-in with Steam refused: {}", e.getMessage());
            return redirect.location(URI.create(LOGIN_FAILED)).build();
        }
    }

    /**
     * The sign-in with FACEIT is a later step; until it exists every request for it is answered as for a provider that
     * is off.
     */
    @GetMapping({"/faceit/start", "/faceit/callback"})
    public void faceit() {
        throw new NotFoundException(AUTH_PROVIDER_DISABLED, "Signing in with FACEIT is not available");
    }

    /**
     * The visitor the request's session cookie belongs to, or 204 No Content (no body) when it has none that is live. A
     * visitor who is not signed in is the common case, not an error: every page asks this once, and a 401 would make
     * the browser print a failed request in the console of every visitor. It is the cookie that is asked, not what else
     * the request is authenticated as: the admin key does not turn a signed-in visitor into a signed-out one (see
     * {@link SessionAuthFilter}).
     */
    @GetMapping("/me")
    public ResponseEntity<MeResponse> me(
            @RequestAttribute(name = SessionAuthFilter.USER_ATTRIBUTE, required = false) SignedInUser user) {
        if (user == null) {
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.ok(MeResponse.of(user));
    }

    /** Ends the session of the request's cookie, if it has one, and clears the cookie. 204 either way. */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request) {
        AuthCookies.sessionToken(request).ifPresent(sessions::delete);
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, AuthCookies.clearedSession(RequestOrigin.isHttps(request)).toString())
                .build();
    }
}
