package io.csfaceit.backend.auth;

import io.csfaceit.backend.clip.worker.WorkerTokenAuthFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Authenticates a request as {@code ROLE_USER} when its {@code csf_session} cookie holds the token of a session that is
 * there and has not ended; the principal is then the {@link SignedInUser}. It never rejects anything itself: a request
 * with no cookie, or with a cookie that is unknown, expired or malformed, simply stays anonymous, so a stale cookie can
 * never turn a public page into a 401. Not a Spring bean on purpose, for the reason {@code ApiKeyAuthFilter} gives.
 *
 * <p><b>A session identifies a visitor and authorizes nothing that is protected.</b> Everything that needs the admin key
 * (uploading and analyzing a demo, ordering and deleting a clip) is decided by the last rule of {@code SecurityConfig},
 * which asks for the authority of that key, and {@code ROLE_USER} is not it. The role {@code ADMIN} a user may have
 * been given from {@code auth.admin-steam-ids} is data for now: this filter gives an administrator the same
 * {@code ROLE_USER} as everybody else, so that no session, whoever's, can do what only the key does. Letting an
 * administrator act without the key is a later step and needs a rule of its own.
 *
 * <p>It goes after the filters of the admin key and of the worker token and does not replace an identity that one of
 * them has given: a request that carries both a session cookie and the admin key is the admin's, and what it is allowed
 * to do is decided by that. The visitor the cookie belongs to is still known, as the request attribute
 * {@link #USER_ATTRIBUTE}, which is what {@code /api/v1/auth/me} answers from and what a later step that records who
 * did something can use: an administrator who orders a clip with the key is a signed-in visitor too. The filter looks
 * at no request to the recorder's API ({@code /api/worker/**}), which takes the worker token and nothing else, so that
 * a cookie changes none of its answers.
 *
 * <p>Runs on every dispatch, as {@code ApiKeyAuthFilter} does: the identity lives in the security context of the dispatch
 * that set it, and the container re-enters the filter chain for the dispatch to {@code /error} after a
 * {@code sendError} and for the dispatch back into the servlet after async processing. The cookie is still on those
 * requests, so it is simply read again.
 */
public class SessionAuthFilter extends OncePerRequestFilter {

    /** The role a session gives; the authority is {@code ROLE_} and this. */
    public static final String ROLE = "USER";

    /**
     * The request attribute that holds the {@link SignedInUser} the request's cookie belongs to, when it belongs to
     * one. It is set whatever else authenticated the request.
     */
    public static final String USER_ATTRIBUTE = "io.csfaceit.backend.auth.SessionAuthFilter.USER";

    private static final List<GrantedAuthority> AUTHORITIES = List.of(new SimpleGrantedAuthority("ROLE_" + ROLE));

    private final SecurityContextHolderStrategy contextHolder = SecurityContextHolder.getContextHolderStrategy();

    private final SessionService sessions;

    public SessionAuthFilter(SessionService sessions) {
        this.sessions = sessions;
    }

    @Override
    protected boolean shouldNotFilterAsyncDispatch() {
        return false;
    }

    @Override
    protected boolean shouldNotFilterErrorDispatch() {
        return false;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!WorkerTokenAuthFilter.isWorkerRequest(request)) {
            AuthCookies.sessionToken(request).flatMap(sessions::find).ifPresent(user -> {
                request.setAttribute(USER_ATTRIBUTE, user);
                if (contextHolder.getContext().getAuthentication() == null) {
                    SecurityContext context = contextHolder.createEmptyContext();
                    context.setAuthentication(
                            UsernamePasswordAuthenticationToken.authenticated(user, null, AUTHORITIES));
                    contextHolder.setContext(context);
                }
            });
        }
        chain.doFilter(request, response);
    }
}
