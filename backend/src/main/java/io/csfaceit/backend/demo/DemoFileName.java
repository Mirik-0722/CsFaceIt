package io.csfaceit.backend.demo;

import io.csfaceit.backend.match.MatchSource;
import java.net.URI;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Which match a demo file belongs to, read from its name. The page has the same function ({@code matchIdFromDemoName}
 * in {@code frontend/src/lib/demoName.ts}); the two read the same names. Three names are known:
 *
 * <ul>
 *   <li>FACEIT names the demo of the first map of a match {@code <match id>-1-1.dem}, compressed or not
 *       ({@code .dem.gz}, {@code .dem.zst}, ...), and that is the only map the site takes. It gives the FACEIT match
 *       id.
 *   <li>Valve's replay servers name the demo of a matchmaking match {@code <match id>_<reservation id>.dem.bz2}, the
 *       match id zero-padded to 21 digits
 *       ({@code http://replay<n>.valve.net/730/003712345678901234567_1234567890.dem.bz2}). Also without the
 *       compression ({@code .dem}) or with another one, as for FACEIT's names.
 *   <li>The CS2 client keeps a demo it downloaded in its replays folder as
 *       {@code match730_<match id zero-padded to 21>_<n>_<n>.dem}. This form is written from memory of the client's
 *       files, not from a real file: if a real one differs, this is the place to fix (and the page's twin).
 * </ul>
 *
 * The two Valve names give {@code mm-<match id>}, the id in decimal without its zeros, by the one rule for such ids
 * ({@link MatchSource#matchmakingId}). A Valve name may carry the counter a browser adds to a file it saves a second
 * time ({@code ... (1).dem.bz2}, also without the space and between or after the extensions), as the page reads it:
 * a dropped file whose match the page found is not refused here for that. Folders before the name are ignored.
 */
public final class DemoFileName {

    private static final Pattern FACEIT_NAME = Pattern.compile(
            "(1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-1-1\\.dem(?:\\.[a-z0-9]+)?",
            Pattern.CASE_INSENSITIVE);

    /** The counter a browser adds to a file it saves again: {@code " (1)"} or {@code "(1)"}. */
    private static final String COPY = "(?: ?\\([0-9]+\\))?";

    /** What follows the numbers of a Valve name: {@code .dem} and at most one more extension. */
    private static final String DEMO_TAIL = COPY + "\\.dem" + COPY + "(?:\\.[a-z0-9]+" + COPY + ")?";

    private static final Pattern VALVE_REPLAY_NAME = Pattern.compile(
            "([0-9]{1,32})_[0-9]{1,20}" + DEMO_TAIL, Pattern.CASE_INSENSITIVE);

    private static final Pattern VALVE_CLIENT_NAME = Pattern.compile(
            "match730_([0-9]{1,32})_[0-9]{1,20}_[0-9]{1,20}" + DEMO_TAIL, Pattern.CASE_INSENSITIVE);

    private DemoFileName() {
    }

    /**
     * The public id of the match that the name of a demo file names: the FACEIT match id in lower case, or
     * {@code mm-<match id>} for a Valve name; empty for any other name.
     */
    public static Optional<String> matchId(String fileName) {
        if (fileName == null) {
            return Optional.empty();
        }
        String name = fileName.trim();
        name = name.substring(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
        Matcher faceit = FACEIT_NAME.matcher(name);
        if (faceit.matches()) {
            return Optional.of(faceit.group(1).toLowerCase(Locale.ROOT));
        }
        for (Pattern valve : new Pattern[] {VALVE_REPLAY_NAME, VALVE_CLIENT_NAME}) {
            Matcher matcher = valve.matcher(name);
            if (matcher.matches()) {
                return MatchSource.matchmakingId(matcher.group(1));
            }
        }
        return Optional.empty();
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
