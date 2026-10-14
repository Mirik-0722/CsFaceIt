package io.csfaceit.backend.demo;

import io.csfaceit.backend.common.api.BadRequestException;
import io.csfaceit.backend.match.MatchSource;

/**
 * A demo link that a player pasted is refused before anything connects to it: 400 with one of three codes. The message
 * goes into the answer and the log, so it never holds the link itself; it names at most the host, and only when the
 * host is the reason.
 */
public class DemoLinkRefusedException extends BadRequestException {

    /** The link is not an address this site follows: not http or https, a user name in it, no host name, an IP address. */
    public static final String DEMO_LINK_INVALID = "DEMO_LINK_INVALID";

    /** The host is not on {@code demo.link.allowed-origins}, or one of its addresses is not public. */
    public static final String DEMO_LINK_HOST_NOT_ALLOWED = "DEMO_LINK_HOST_NOT_ALLOWED";

    /** The file the link names is not the demo of the match it was pasted for. */
    public static final String DEMO_LINK_MISMATCH = "DEMO_LINK_MISMATCH";

    /** The host did not resolve, which may pass: the only refusal that asking again later can change. */
    private final boolean unresolvedHost;

    private DemoLinkRefusedException(String code, String message) {
        this(code, message, false);
    }

    private DemoLinkRefusedException(String code, String message, boolean unresolvedHost) {
        super(code, message);
        this.unresolvedHost = unresolvedHost;
    }

    /**
     * Whether the link was refused only because its host did not resolve. The answer is {@code DEMO_LINK_INVALID} as for
     * a link that is no address at all; the site's own imports (the CS2 walk) try such a link again later.
     */
    public boolean isUnresolvedHost() {
        return unresolvedHost;
    }

    static DemoLinkRefusedException invalid(String reason) {
        return new DemoLinkRefusedException(DEMO_LINK_INVALID, "The demo link is not usable: " + reason);
    }

    static DemoLinkRefusedException hostNotAllowed(String host, String reason) {
        return new DemoLinkRefusedException(DEMO_LINK_HOST_NOT_ALLOWED,
                "The demo link leads to " + host + ", which " + reason);
    }

    static DemoLinkRefusedException unresolved(String host) {
        return new DemoLinkRefusedException(DEMO_LINK_INVALID,
                "The demo link is not usable: its host " + host + " does not resolve", true);
    }

    static DemoLinkRefusedException mismatch(String matchId) {
        String name = MatchSource.isMatchmaking(matchId)
                ? "Valve's name of the match's demo, <match id>_<number>.dem.bz2"
                : "the match's id followed by -1-1.dem";
        return new DemoLinkRefusedException(DEMO_LINK_MISMATCH,
                "The file of the demo link is not the demo of match " + matchId + ": the name of the file has to be "
                        + name);
    }
}
