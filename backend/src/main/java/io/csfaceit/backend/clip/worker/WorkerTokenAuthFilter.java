package io.csfaceit.backend.clip.worker;

import static java.nio.charset.StandardCharsets.UTF_8;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.FilterChain;
import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Authenticates a request to the recorder's API ({@code /api/worker/**}) as {@code ROLE_WORKER} when its
 * {@code X-Worker-Token} header equals the configured token. It looks at no other path, so the token opens nothing
 * outside the worker API, and like {@code ApiKeyAuthFilter} it never rejects anything itself: a request without a
 * matching token keeps the identity it has (none, or the admin role that a valid {@code X-API-Key} gave it before
 * this filter), and the authorization rules turn that into a 401 or a 403. It runs after the admin key's filter, so a
 * request that presents both is a worker's on this path. Not a Spring bean on purpose, for the reason given there.
 *
 * <p>Fails closed: with no usable configured token nothing authenticates, so an unset {@code CLIP_WORKER_TOKEN} can
 * never be matched by an absent or empty header. A token is unusable when it is null or blank, or has leading or
 * trailing whitespace (containers trim header values, so such a token could never be presented); a WARN says so at
 * startup. The token itself is never logged.
 *
 * <p>Runs on every dispatch, as {@code ApiKeyAuthFilter} does: the identity lives in the security context of the
 * dispatch that set it, and the container re-enters the filter chain, with the authorization rules, for the dispatch
 * to {@code /error} after a {@code sendError} and for the dispatch back into the servlet after async processing. On
 * the error dispatch the request is for {@code /error}, so the path looked at is the one the failed request had.
 */
public class WorkerTokenAuthFilter extends OncePerRequestFilter {

    public static final String HEADER_NAME = "X-Worker-Token";

    /** Everything at and below this path is the recorder's API. */
    public static final String PATH_ROOT = "/api/worker";

    /** The role the token gives; the authority is {@code ROLE_} and this. */
    public static final String ROLE = "WORKER";

    private static final Logger log = LoggerFactory.getLogger(WorkerTokenAuthFilter.class);

    private static final String PRINCIPAL = "worker-token";
    private static final List<GrantedAuthority> AUTHORITIES = List.of(new SimpleGrantedAuthority("ROLE_" + ROLE));

    private final SecurityContextHolderStrategy contextHolder = SecurityContextHolder.getContextHolderStrategy();

    /** The configured token as UTF-8 bytes, or {@code null} when there is no usable token. */
    private final byte[] expectedToken;

    public WorkerTokenAuthFilter(String workerToken) {
        String problem = problemWith(workerToken);
        if (problem == null) {
            this.expectedToken = workerToken.getBytes(UTF_8);
        } else {
            // The token itself is never logged.
            log.warn("The worker token is unusable ({}): the worker API will reject every request", problem);
            this.expectedToken = null;
        }
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
        if (isWorkerPath(requestedPath(request)) && matches(request.getHeader(HEADER_NAME))) {
            SecurityContext context = contextHolder.createEmptyContext();
            context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(PRINCIPAL, null, AUTHORITIES));
            contextHolder.setContext(context);
        }
        chain.doFilter(request, response);
    }

    /** Whether the path is the recorder's API: {@code /api/worker} and what is below it, not {@code /api/workers}. */
    public static boolean isWorkerPath(String path) {
        return path.equals(PATH_ROOT) || path.startsWith(PATH_ROOT + "/");
    }

    /** The path the client asked for; on the error dispatch the container has put it in a request attribute. */
    private static String requestedPath(HttpServletRequest request) {
        if (request.getDispatcherType() == DispatcherType.ERROR
                && request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI) instanceof String original) {
            return original;
        }
        return request.getRequestURI();
    }

    /** Why the token can never match, or {@code null} when it is usable. */
    private static String problemWith(String workerToken) {
        if (workerToken == null || workerToken.isBlank()) {
            return "it is blank";
        }
        if (!workerToken.equals(workerToken.strip())) {
            return "it has leading or trailing whitespace, which header values never carry";
        }
        return null;
    }

    /** Compared in constant time, so the response time does not reveal how much of a guessed token was right. */
    private boolean matches(String presentedToken) {
        if (expectedToken == null || presentedToken == null) {
            return false;
        }
        return MessageDigest.isEqual(expectedToken, presentedToken.getBytes(UTF_8));
    }
}
