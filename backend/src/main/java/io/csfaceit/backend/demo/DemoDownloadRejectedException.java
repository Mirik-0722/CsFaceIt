package io.csfaceit.backend.demo;

/**
 * The demo cannot be downloaded, and trying again would fail the same way (FACEIT refuses the download, the file is
 * too large, the address is not usable). Unlike its parent, the message is a fixed sentence for the user, built
 * from nothing but the cause: it is stored in {@code demos.error}, which the API shows, so it never contains a URL or
 * host name.
 */
public class DemoDownloadRejectedException extends DemoDownloadException {

    public DemoDownloadRejectedException(String message) {
        super(message);
    }

    /** FACEIT answered the download request with {@code status}, which will not change by asking again. */
    public static DemoDownloadRejectedException forStatus(int status) {
        return new DemoDownloadRejectedException("Demo download rejected: HTTP " + status
                + ". FACEIT Downloads API access may be required; upload the .dem manually.");
    }
}
