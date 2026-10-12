package io.csfaceit.backend.auth;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.http.HttpHeaders;

/**
 * The origin the browser used to reach the site: the scheme and the host (with the port, when the browser sent one) of
 * its address, such as {@code https://example.com} or {@code http://localhost:3000}. It is read from the request and
 * from no setting, because one and the same image is reached through a domain over HTTPS, through a bare address over
 * HTTP and through {@code localhost}, and the address Steam is told to send the visitor back to has to be the one the
 * visitor is on.
 *
 * <p>The host is the {@code Host} header, which the Nginx of the stack passes on as the browser sent it. The scheme
 * is that of the {@code X-Forwarded-Proto} header when it says {@code http} or {@code https}, which a proxy in front
 * of the Nginx (Caddy, a load balancer) sets and the Nginx passes on, and otherwise the request's own. A header that
 * says anything else is ignored, and a {@code Host} that is not a host name or an address with an optional port gives
 * no origin at all, so that nothing a client sends can put a character into an address that does not belong in one.
 *
 * @param host the {@code Host} header as received, with its port if it had one
 */
record RequestOrigin(String scheme, String host) {

    private static final String FORWARDED_PROTO = "X-Forwarded-Proto";
    private static final int HOST_MAX_LENGTH = 255;

    /** A host name or an IPv4 address, or an IPv6 address in brackets; then optionally a port. */
    private static final Pattern HOST = Pattern.compile("(?:[A-Za-z0-9._-]+|\\[[0-9A-Fa-f:.]+\\])(?::[0-9]{1,5})?");

    /** The origin of the request, or empty when its {@code Host} cannot be used. */
    static Optional<RequestOrigin> of(HttpServletRequest request) {
        String host = request.getHeader(HttpHeaders.HOST);
        if (host == null || host.length() > HOST_MAX_LENGTH || !HOST.matcher(host).matches()) {
            return Optional.empty();
        }
        return Optional.of(new RequestOrigin(schemeOf(request), host));
    }

    /** Whether the browser is on HTTPS, which is when a cookie is marked {@code Secure}. */
    boolean secure() {
        return "https".equals(scheme);
    }

    /**
     * Whether the browser is on HTTPS, when the origin as a whole is not wanted: a cookie is cleared with the
     * attributes it was set with, whether or not the {@code Host} of that request is one that can be used.
     */
    static boolean isHttps(HttpServletRequest request) {
        return "https".equals(schemeOf(request));
    }

    /** The origin as written in an address: no trailing slash. */
    String value() {
        return scheme + "://" + host;
    }

    /**
     * The first value of {@code X-Forwarded-Proto} (a chain of proxies may have added more, separated by commas) when
     * it is {@code http} or {@code https}, else the scheme of the request.
     */
    private static String schemeOf(HttpServletRequest request) {
        String forwarded = request.getHeader(FORWARDED_PROTO);
        if (forwarded != null) {
            String first = forwarded.split(",", 2)[0].strip().toLowerCase(Locale.ROOT);
            if (first.equals("http") || first.equals("https")) {
                return first;
            }
        }
        return request.getScheme().toLowerCase(Locale.ROOT);
    }
}
