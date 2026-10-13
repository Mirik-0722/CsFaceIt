package io.csfaceit.backend.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.clip.worker.WorkerTokenAuthFilter;
import io.csfaceit.backend.common.api.ApiError;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Authenticates a request as {@code ROLE_USER} when its {@code csf_session} cookie holds the token of a session that is
 * there and has not ended, and as {@code ROLE_ADMIN} in addition when the session is an administrator's; the principal
 * is then the {@link SignedInUser}. A request with no cookie, or with a cookie
 * that is unknown, expired or malformed, simply stays anonymous, so a stale cookie can never turn a public page into a
 * 401. The one thing this filter refuses is a write that does not come from the site itself (below). Not a Spring bean
 * on purpose, for the reason {@code ApiKeyAuthFilter} gives.
 *
 * <p><b>A write that rides on the session cookie must come from the site itself.</b> A request that carries a
 * {@code csf_session} cookie, is not authenticated by the admin key or the worker token and has a method other than
 * {@code GET}, {@code HEAD} or {@code OPTIONS} is answered 403 {@code CROSS_SITE_REQUEST} unless its {@code Origin}
 * header is one of the {@link KnownOrigins}; a request with no {@code Origin} is refused too. {@code SameSite=Lax}
 * already keeps the browser from sending the cookie with a form or a script of another site, and this rule stands
 * behind it for what that does not cover (a browser that ignores the attribute, a site that shares the registrable
 * domain). The cookie is looked for and not checked, so a request with a stale one is refused as well and the answer
 * says nothing of whether a token was live. A browser always names its origin in a write, so no page loses anything
 * to this; a script that is not a browser has the admin key. Signing out falls under the rule like any other write.
 * A request that a page of another origin makes to this host is answered 403 by the CORS filter, which comes first
 * (see {@code SecurityConfig}), unless that origin is in its list; what this rule adds is the request with no
 * {@code Origin} at all and the one whose {@code Origin} is the host it is sent to but not a known origin.
 *
 * <p><b>What a session may do.</b> {@code ROLE_USER} opens the few writes that {@code SecurityConfig} lists for it
 * (bringing and analyzing a demo, ordering, retrying and deleting a clip), and nothing else that is protected; whether
 * this user may do it for this match, player or clip is then decided by {@link Access}. An administrator, a user whose
 * SteamID is in {@code auth.admin-steam-ids} now ({@link SessionService#find} works the role out at every request),
 * gets {@code ROLE_ADMIN} as well, the authority of the admin key, and so reaches everything the key reaches; the
 * worker API stays the worker token's. That makes an administrator's cookie as strong as the key, which is why the
 * rule above stands in front of it and why taking a SteamID off the list ends it at once.
 *
 * <p>It goes after the filters of the admin key and of the worker token and does not replace an identity that one of
 * them has given: a request that carries both a session cookie and the admin key is the key's, and what it is allowed
 * to do, and whom it is recorded for (nobody), is decided by that. The visitor the cookie belongs to is still known,
 * as the request attribute {@link #USER_ATTRIBUTE}, which is what {@code /api/v1/auth/me} answers from. The filter looks
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

    /** The {@code code} of the 403 that refuses a write made from somewhere that is not the site. */
    public static final String CROSS_SITE_REQUEST = "CROSS_SITE_REQUEST";

    private static final String CROSS_SITE_MESSAGE =
            "A request that carries the session cookie has to be made from this site";

    /** The methods that change nothing: the rule leaves them alone, and so does any other that is not in this set. */
    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS");

    /**
     * The role an administrator's session gives in addition: the one the admin key gives, so that every rule that asks
     * for the key is satisfied by an administrator too.
     */
    public static final String ADMIN_ROLE = "ADMIN";

    private static final List<GrantedAuthority> AUTHORITIES = List.of(new SimpleGrantedAuthority("ROLE_" + ROLE));

    private static final List<GrantedAuthority> ADMIN_AUTHORITIES = List.of(
            new SimpleGrantedAuthority("ROLE_" + ROLE), new SimpleGrantedAuthority("ROLE_" + ADMIN_ROLE));

    private static final Logger log = LoggerFactory.getLogger(SessionAuthFilter.class);

    private final SecurityContextHolderStrategy contextHolder = SecurityContextHolder.getContextHolderStrategy();

    private final SessionService sessions;
    private final KnownOrigins knownOrigins;
    private final ObjectMapper mapper;

    public SessionAuthFilter(SessionService sessions, KnownOrigins knownOrigins, ObjectMapper mapper) {
        this.sessions = sessions;
        this.knownOrigins = knownOrigins;
        this.mapper = mapper;
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
            Optional<String> token = AuthCookies.sessionToken(request);
            if (token.isPresent() && isWriteOnTheCookie(request) && !isFromThisSite(request)) {
                refuseCrossSite(request, response);
                return;
            }
            token.flatMap(sessions::find).ifPresent(user -> {
                request.setAttribute(USER_ATTRIBUTE, user);
                if (contextHolder.getContext().getAuthentication() == null) {
                    SecurityContext context = contextHolder.createEmptyContext();
                    context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user, null,
                            user.role() == UserRole.ADMIN ? ADMIN_AUTHORITIES : AUTHORITIES));
                    contextHolder.setContext(context);
                }
            });
        }
        chain.doFilter(request, response);
    }

    /**
     * Whether the request is one that can change something and has no credential but the cookie to do it with: a method
     * outside {@link #SAFE_METHODS}, and no identity yet, because the filters of the admin key and of the worker token
     * come first and a request one of them has authenticated is theirs.
     */
    private boolean isWriteOnTheCookie(HttpServletRequest request) {
        return !SAFE_METHODS.contains(request.getMethod()) && contextHolder.getContext().getAuthentication() == null;
    }

    /** Whether the {@code Origin} header names one of the known origins. A request without one does not. */
    private boolean isFromThisSite(HttpServletRequest request) {
        return knownOrigins.contains(request.getHeader(HttpHeaders.ORIGIN));
    }

    /** Answers 403 with the shared {@link ApiError} body, written directly as the other refusals of the chain are. */
    private void refuseCrossSite(HttpServletRequest request, HttpServletResponse response) throws IOException {
        // The origin is named so that an operator whose proxy hides the real one finds out what to put in PUBLIC_ORIGIN;
        // it is the client's, so it is only quoted when it has the shape of an origin.
        log.warn("Refused a {} request that carries a session cookie: its origin is {}, which is not a known origin of "
                + "this site", request.getMethod(), KnownOrigins.forLog(request.getHeader(HttpHeaders.ORIGIN)));
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        mapper.writeValue(response.getOutputStream(), new ApiError(CROSS_SITE_REQUEST, CROSS_SITE_MESSAGE));
    }
}
