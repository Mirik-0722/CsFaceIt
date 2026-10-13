package io.csfaceit.backend.auth;

import io.csfaceit.backend.config.AppProperties;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The origins the site is reached at, as the operator has said them: {@code app.cors.allowed-origins}
 * ({@code CORS_ALLOWED_ORIGINS}) and {@code PUBLIC_ORIGIN} when that is set. Nothing a request says can add to the list.
 *
 * <p>Two things rest on it. The address Steam is told to send a visitor back to is built from the origin of the
 * request ({@link RequestOrigin}), which comes from the {@code Host} header, so without a list any name that points at
 * the server would be served as the site and would get a session cookie for itself; with it, such a request is refused
 * before anything is issued. And a write that rides on the session cookie must name one of these origins in its
 * {@code Origin} header (see {@link SessionAuthFilter}), which keeps a page of another site from acting for a visitor.
 *
 * <p>An origin is a scheme, a host and a port when it is not the default one of the scheme, with no path:
 * {@code https://example.com}, {@code http://localhost:3000}. Two spellings of the same origin are one, as a browser
 * and the CORS check see them: the letters of the host in any case, a trailing slash, and the default port written out
 * ({@code http://example.com:80}). An entry that is not an origin never matches anything and is reported at startup, and
 * so is a list with nothing in it.
 */
@Component
public class KnownOrigins {

    private static final Logger log = LoggerFactory.getLogger(KnownOrigins.class);

    private static final int MAX_LENGTH = 255;

    /** The shape of an origin as {@link RequestOrigin} can build one: http or https, a host as it accepts it, a port. */
    private static final Pattern ORIGIN = Pattern.compile(
            "https?://(?:[A-Za-z0-9._-]+|\\[[0-9A-Fa-f:.]+\\])(?::[0-9]{1,5})?");

    private final Set<String> origins;

    /**
     * @param properties the CORS settings, whose list of origins is the main part of this one
     * @param publicOrigin the origin the visitors reach the site at when that is none of the origins above, such as the
     *        address of a server without a domain; empty when unset
     */
    public KnownOrigins(AppProperties properties, @Value("${app.public-origin:}") String publicOrigin) {
        Set<String> known = new LinkedHashSet<>();
        List<String> cors = properties.cors() == null || properties.cors().allowedOrigins() == null
                ? List.of() : properties.cors().allowedOrigins();
        cors.forEach(entry -> add(known, entry, "CORS_ALLOWED_ORIGINS"));
        if (publicOrigin != null) {
            for (String entry : publicOrigin.split(",")) {
                add(known, entry, "PUBLIC_ORIGIN");
            }
        }
        this.origins = Set.copyOf(known);
        if (known.isEmpty()) {
            log.warn("No origin is known (CORS_ALLOWED_ORIGINS and PUBLIC_ORIGIN hold none): nobody can sign in, and "
                    + "every write that carries a session cookie is refused");
        } else {
            log.info("Known origins of the site, for signing in and for writes with a session cookie: {}", known);
        }
    }

    /**
     * The origin the request was made at, when it is a known one: the scheme and the host the visitor's browser used
     * (see {@link RequestOrigin#of}), only if that origin is on the list. Empty when the {@code Host} cannot be used
     * and when the origin it makes is not known.
     */
    public Optional<RequestOrigin> of(HttpServletRequest request) {
        return RequestOrigin.of(request).filter(candidate -> contains(candidate.value()));
    }

    /** Whether the origin, as a browser writes it in an {@code Origin} header, is on the list. {@code null} is not. */
    public boolean contains(String origin) {
        return origin != null && origins.contains(normalize(origin));
    }

    /**
     * The value as it can be put in a log line: itself when it has the shape of an origin, else a note. The {@code Origin}
     * header is the client's, and a log line must not take whatever it holds.
     */
    static String forLog(String origin) {
        if (origin == null) {
            return "(none)";
        }
        return origin.length() <= MAX_LENGTH && ORIGIN.matcher(origin).matches() ? origin : "(not an origin)";
    }

    private static void add(Set<String> known, String entry, String setting) {
        if (entry == null || entry.isBlank()) {
            return;
        }
        String origin = normalize(entry);
        if (ORIGIN.matcher(origin).matches()) {
            known.add(origin);
        } else {
            // The entry is the operator's own setting, not something a request sent, so it may be quoted.
            log.warn("{} holds an entry that is not an origin (scheme://host, with :port when it is not the default): "
                    + "{}. It is ignored", setting, entry.strip());
        }
    }

    /** One spelling for the origins a browser takes for one: no case, no trailing slash, no default port. */
    private static String normalize(String origin) {
        String value = origin.strip().toLowerCase(Locale.ROOT);
        if (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        if (value.startsWith("http://") && value.endsWith(":80")) {
            value = value.substring(0, value.length() - ":80".length());
        } else if (value.startsWith("https://") && value.endsWith(":443")) {
            value = value.substring(0, value.length() - ":443".length());
        }
        return value;
    }
}
