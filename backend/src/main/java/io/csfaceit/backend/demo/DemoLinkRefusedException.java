package io.csfaceit.backend.demo;

import io.csfaceit.backend.common.api.BadRequestException;

/**
 * A demo link that a player pasted is refused before anything connects to it: 400 with one of three codes. The message
 * goes into the answer and the log, so it never holds the link itself; it names at most the host, and only when the
 * host is the reason ({@link #host()}).
 */
public class DemoLinkRefusedException extends BadRequestException {

    /** The link is not an address this site follows: not http or https, a user name in it, no host name, an IP address. */
    public static final String DEMO_LINK_INVALID = "DEMO_LINK_INVALID";

    /** The host is not on {@code demo.link.allowed-origins}, or one of its addresses is not public. */
    public static final String DEMO_LINK_HOST_NOT_ALLOWED = "DEMO_LINK_HOST_NOT_ALLOWED";

    /** The file the link names is not the demo of the match it was pasted for. */
    public static final String DEMO_LINK_MISMATCH = "DEMO_LINK_MISMATCH";

    private final String host;

    private DemoLinkRefusedException(String code, String message, String host) {
        super(code, message);
        this.host = host;
    }

    static DemoLinkRefusedException invalid(String reason) {
        return new DemoLinkRefusedException(DEMO_LINK_INVALID, "The demo link is not usable: " + reason, null);
    }

    static DemoLinkRefusedException hostNotAllowed(String host, String reason) {
        return new DemoLinkRefusedException(DEMO_LINK_HOST_NOT_ALLOWED,
                "The demo link leads to " + host + ", which " + reason, host);
    }

    static DemoLinkRefusedException unresolved(String host) {
        return new DemoLinkRefusedException(DEMO_LINK_INVALID,
                "The demo link is not usable: its host " + host + " does not resolve", host);
    }

    static DemoLinkRefusedException mismatch(String faceitMatchId) {
        return new DemoLinkRefusedException(DEMO_LINK_MISMATCH,
                "The file of the demo link is not the demo of match " + faceitMatchId
                        + ": the name of the file has to be the match's id followed by -1-1.dem", null);
    }

    /** The host that was refused, or null when the host is not the reason. */
    public String host() {
        return host;
    }
}
