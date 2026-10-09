package io.csfaceit.backend.config;

import static java.nio.charset.StandardCharsets.UTF_8;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.List;
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
 * <p>Fails closed: with no usable configured key (null or blank) nothing authenticates, so an unset
 * {@code APP_API_KEY} can never be matched by an absent or empty header.
 */
public class ApiKeyAuthFilter extends OncePerRequestFilter {

    public static final String HEADER_NAME = "X-API-Key";

    private static final String PRINCIPAL = "api-key";
    private static final List<GrantedAuthority> AUTHORITIES = List.of(new SimpleGrantedAuthority("ROLE_ADMIN"));

    private final SecurityContextHolderStrategy contextHolder = SecurityContextHolder.getContextHolderStrategy();

    /** The configured key as UTF-8 bytes, or {@code null} when there is no usable key. */
    private final byte[] expectedKey;

    public ApiKeyAuthFilter(String apiKey) {
        this.expectedKey = apiKey == null || apiKey.isBlank() ? null : apiKey.getBytes(UTF_8);
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

    /** Compared in constant time, so the response time does not reveal how much of a guessed key was right. */
    private boolean matches(String presentedKey) {
        if (expectedKey == null || presentedKey == null) {
            return false;
        }
        return MessageDigest.isEqual(expectedKey, presentedKey.getBytes(UTF_8));
    }
}
