package io.csfaceit.backend.config;

import static java.nio.charset.StandardCharsets.UTF_8;

import jakarta.servlet.FilterChain;
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
 * Authenticates a request as {@code ROLE_ADMIN} when its {@code X-API-Key} header equals the configured key. It never
 * rejects anything itself: a request without a matching key simply stays anonymous, and the authorization rules decide
 * whether that is enough. Not a Spring bean on purpose: the security filter chain owns it, and a bean would also be
 * registered as a plain servlet filter outside the chain.
 *
 * <p>Fails closed: with no usable configured key nothing authenticates, so an unset {@code APP_API_KEY} can never be
 * matched by an absent or empty header. A key is unusable when it is null or blank, or has leading or trailing
 * whitespace (containers trim header values, so such a key could never be presented); a WARN says so at startup.
 *
 * <p>Runs on every dispatch, not only the first one: the identity lives in the security context of the dispatch that
 * set it, while the container re-enters the filter chain, and with it the authorization rules, for the dispatch to
 * {@code /error} after a {@code sendError} (a 403 for instance) and for the dispatch back into the servlet after
 * async processing. The header is still on those requests, so the key is simply read again.
 */
public class ApiKeyAuthFilter extends OncePerRequestFilter {

    public static final String HEADER_NAME = "X-API-Key";

    /**
     * The role the key gives; the authority is {@code ROLE_} and this. The last authorization rule asks for it by this
     * name: it is what separates the key from a session, which authenticates a request without being it.
     */
    public static final String ROLE = "ADMIN";

    private static final Logger log = LoggerFactory.getLogger(ApiKeyAuthFilter.class);

    private static final String PRINCIPAL = "api-key";
    private static final List<GrantedAuthority> AUTHORITIES = List.of(new SimpleGrantedAuthority("ROLE_" + ROLE));

    private final SecurityContextHolderStrategy contextHolder = SecurityContextHolder.getContextHolderStrategy();

    /** The configured key as UTF-8 bytes, or {@code null} when there is no usable key. */
    private final byte[] expectedKey;

    public ApiKeyAuthFilter(String apiKey) {
        String problem = problemWith(apiKey);
        if (problem == null) {
            this.expectedKey = apiKey.getBytes(UTF_8);
        } else {
            // The key itself is never logged.
            log.warn("The admin API key is unusable ({}): protected endpoints will reject every request", problem);
            this.expectedKey = null;
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
        if (matches(request.getHeader(HEADER_NAME))) {
            SecurityContext context = contextHolder.createEmptyContext();
            context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(PRINCIPAL, null, AUTHORITIES));
            contextHolder.setContext(context);
        }
        chain.doFilter(request, response);
    }

    /** Why the key can never match, or {@code null} when it is usable. */
    private static String problemWith(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) {
            return "it is blank";
        }
        if (!apiKey.equals(apiKey.strip())) {
            return "it has leading or trailing whitespace, which header values never carry";
        }
        return null;
    }

    /** Compared in constant time, so the response time does not reveal how much of a guessed key was right. */
    private boolean matches(String presentedKey) {
        if (expectedKey == null || presentedKey == null) {
            return false;
        }
        return MessageDigest.isEqual(expectedKey, presentedKey.getBytes(UTF_8));
    }
}
