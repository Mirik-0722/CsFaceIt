package io.csfaceit.backend.auth;

import java.net.URI;
import java.net.URISyntaxException;

/**
 * Where a visitor is sent after signing in. Only a path of this site is ever allowed, so that the sign-in cannot be
 * made to send anybody to another site: the redirect target must start with a single {@code /}, must not start with
 * {@code //} (that is another host, written without a scheme), must not hold a backslash (a browser reads
 * {@code /\evil.example} as {@code //evil.example}) or a control character (a browser drops a tab or a line break
 * inside an address, so {@code /<tab>/evil.example} is {@code //evil.example} too, and a line break would end the
 * header), and must be a well-formed reference without a scheme or a host. Anything else, and anything absurdly long,
 * becomes {@code /}.
 */
final class ReturnPath {

    /** The home page: where a visitor goes when the path they asked for is not one of this site. */
    static final String HOME = "/";

    /** Long enough for any page of the site with its query; short enough to fit a cookie many times over. */
    private static final int MAX_LENGTH = 512;

    private ReturnPath() {
    }

    /** The path itself when it is a path of this site, else {@link #HOME}. {@code null} is {@link #HOME}. */
    static String sanitize(String path) {
        if (path == null || path.isEmpty() || path.length() > MAX_LENGTH) {
            return HOME;
        }
        if (path.charAt(0) != '/' || path.startsWith("//")) {
            return HOME;
        }
        for (int i = 0; i < path.length(); i++) {
            char c = path.charAt(i);
            if (c == '\\' || Character.isISOControl(c)) {
                return HOME;
            }
        }
        // The rules above are the ones that matter; this is what is left if one was missed: a path that is not a
        // well-formed reference, or that turns out to have a scheme or a host, is not a path of this site.
        try {
            URI uri = new URI(path);
            if (uri.getScheme() != null || uri.getRawAuthority() != null) {
                return HOME;
            }
        } catch (URISyntaxException e) {
            return HOME;
        }
        return path;
    }
}
