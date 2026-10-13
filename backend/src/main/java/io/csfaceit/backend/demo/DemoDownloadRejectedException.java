package io.csfaceit.backend.demo;

/**
 * The demo cannot be downloaded, and trying again would fail the same way (FACEIT refuses the download, the file is
 * too large, the address is not usable). Unlike its parent, the message is a fixed sentence for the user, built
 * from nothing but the cause: it is stored in {@code demos.error}, which the API shows, so it never contains a URL or
 * host name. A rejection that a page can explain in its own words carries the {@link DemoErrorCode} that is stored
 * with it; for any other it is null.
 */
public class DemoDownloadRejectedException extends DemoDownloadException {

    private final DemoErrorCode errorCode;

    public DemoDownloadRejectedException(String message) {
        this(message, null);
    }

    public DemoDownloadRejectedException(String message, DemoErrorCode errorCode) {
        super(message);
        this.errorCode = errorCode;
    }

    /** FACEIT answered the download request with {@code status}, which will not change by asking again. */
    public static DemoDownloadRejectedException forStatus(int status) {
        return new DemoDownloadRejectedException("Demo download rejected: HTTP " + status
                + ". FACEIT Downloads API access may be required; upload the .dem manually.");
    }

    /**
     * FACEIT does not let this site have the file: its Downloads API refused the token, or the site has no token and
     * the demo address (FACEIT's private cloud) answers nobody else. Another try would be refused the same way.
     */
    public static DemoDownloadRejectedException needsAccess() {
        return new DemoDownloadRejectedException("Demo download rejected: FACEIT did not let this site download the demo. "
                + "Download it from the match's room on FACEIT and upload the .dem file manually.",
                DemoErrorCode.DOWNLOAD_NEEDS_ACCESS);
    }

    /** The code of the reason when a page can explain it, otherwise null. */
    public DemoErrorCode errorCode() {
        return errorCode;
    }
}
