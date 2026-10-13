package io.csfaceit.backend.demo;

import java.net.URI;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Which match a demo file belongs to, read from its name. FACEIT names the demo of the first map of a match
 * {@code <match id>-1-1.dem}, compressed or not ({@code .dem.gz}, {@code .dem.zst}, ...), and that is the only map the
 * site takes. The page has the same function ({@code matchIdFromDemoName} in {@code frontend/src/lib/demoName.ts}); the
 * two read the same names.
 */
public final class DemoFileName {

    private static final Pattern NAME = Pattern.compile(
            "(1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-1-1\\.dem(?:\\.[a-z0-9]+)?",
            Pattern.CASE_INSENSITIVE);

    private DemoFileName() {
    }

    /** The FACEIT match id that the name of a demo file names, in lower case; empty for any other name. */
    public static Optional<String> matchId(String fileName) {
        if (fileName == null) {
            return Optional.empty();
        }
        Matcher matcher = NAME.matcher(fileName.trim());
        return matcher.matches() ? Optional.of(matcher.group(1).toLowerCase(Locale.ROOT)) : Optional.empty();
    }

    /** The match id that the file of a link names: the last segment of its path, decoded; the query does not count. */
    static Optional<String> matchIdOfLink(URI link) {
        String path = link.getPath();
        if (path == null || path.isEmpty()) {
            return Optional.empty();
        }
        return matchId(path.substring(path.lastIndexOf('/') + 1));
    }
}
