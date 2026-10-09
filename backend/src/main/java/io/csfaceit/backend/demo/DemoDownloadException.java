package io.csfaceit.backend.demo;

/**
 * A demo could not be downloaded or prepared, and trying again may work (a network error, a server error, a
 * truncated file). The message is meant for logs and may name hosts; it must not be shown to users.
 */
public class DemoDownloadException extends RuntimeException {

    public DemoDownloadException(String message) {
        super(message);
    }

    public DemoDownloadException(String message, Throwable cause) {
        super(message, cause);
    }
}
