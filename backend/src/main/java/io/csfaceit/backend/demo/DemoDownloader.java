package io.csfaceit.backend.demo;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Fetches a demo and turns it into the form that is stored: a zstd file, whatever the demo came as (see
 * {@link DemoFiles}). Nothing is held in memory beyond a copy buffer, nothing is trusted about the size the server
 * announces, and every temporary file is deleted when a method fails.
 */
@Component
public class DemoDownloader {

    /** FACEIT refuses these for good: no access, or no such demo. Asking again changes nothing. */
    private static final Set<Integer> REJECTED_STATUSES = Set.of(401, 403, 404, 410);

    private static final Set<Integer> REDIRECT_STATUSES = Set.of(301, 302, 303, 307, 308);
    private static final int MAX_REDIRECTS = 5;

    private final DemoDownloadProperties properties;

    public DemoDownloader(DemoDownloadProperties properties) {
        this.properties = properties;
    }

    /**
     * Downloads the demo into a temporary file in the system temp directory and normalizes it to zstd. Only
     * {@code http} and {@code https} addresses are used, also when the server redirects. The caller owns the
     * returned file and deletes it. This is for an address that is meant to serve the file to anyone who has it, such
     * as the signed one FACEIT's Downloads API gives.
     *
     * @throws DemoDownloadRejectedException the download will never work: the server refuses it (HTTP 401, 403, 404
     *         or 410), the file is too large, or the address is not usable
     * @throws DemoDownloadException any other failure; trying again may work
     */
    public Path download(String url) {
        return download(url, false);
    }

    /**
     * Like {@link #download(String)}, for the {@code demo_url} of a match fetched as it is, with no access to FACEIT's
     * Downloads API. That address is FACEIT's private cloud: it either does not resolve for anyone outside it, or
     * refuses with HTTP 401 or 403. Neither can change by asking again, so both are the rejection
     * {@link DemoDownloadRejectedException#needsAccess()} and not a failure to retry. Any other host that really serves
     * the file is downloaded as usual.
     */
    public Path downloadFaceitAddress(String url) {
        return download(url, true);
    }

    private Path download(String url, boolean faceitAddress) {
        URI uri = parse(url);
        Path downloaded = DemoFiles.createTempFile();
        boolean done = false;
        try {
            fetch(uri, downloaded, faceitAddress);
            Path normalized = DemoFiles.normalize(downloaded, properties.maxSize());
            done = true;
            return normalized;
        } finally {
            if (!done) {
                DemoFiles.deleteQuietly(downloaded);
            }
        }
    }

    /** Follows the redirects itself so that each hop is checked to be an http or https address. */
    private void fetch(URI start, Path target, boolean faceitAddress) {
        URI uri = start;
        for (int redirects = 0; ; redirects++) {
            requireHttp(uri);
            HttpURLConnection connection = null;
            try {
                connection = open(uri);
                int status = connection.getResponseCode();
                if (REDIRECT_STATUSES.contains(status)) {
                    if (redirects == MAX_REDIRECTS) {
                        throw new DemoDownloadRejectedException(
                                "Demo download rejected: the demo address redirects too many times.");
                    }
                    uri = redirectTarget(uri, connection.getHeaderField("Location"));
                    continue;
                }
                if (REJECTED_STATUSES.contains(status)) {
                    throw faceitAddress && (status == 401 || status == 403)
                            ? DemoDownloadRejectedException.needsAccess()
                            : DemoDownloadRejectedException.forStatus(status);
                }
                if (status < 200 || status >= 300) {
                    throw new DemoDownloadException("The demo server answered HTTP " + status);
                }
                if (connection.getContentLengthLong() > properties.maxSize().toBytes()) {
                    throw DemoFiles.tooLarge(properties.maxSize());
                }
                long size;
                try (InputStream in = connection.getInputStream(); OutputStream out = Files.newOutputStream(target)) {
                    size = DemoFiles.copyBounded(in, out, properties.maxSize());
                }
                if (size == 0) {
                    throw new DemoDownloadException("The demo server sent an empty file");
                }
                return;
            } catch (IOException e) {
                if (faceitAddress && e instanceof UnknownHostException) {
                    throw DemoDownloadRejectedException.needsAccess();
                }
                throw new DemoDownloadException("The demo could not be downloaded: " + e, e);
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }
    }

    private HttpURLConnection open(URI uri) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(millis(properties.connectTimeout()));
        connection.setReadTimeout(millis(properties.readTimeout()));
        connection.setRequestProperty("Accept", "*/*");
        return connection;
    }

    private static URI redirectTarget(URI from, String location) {
        if (location == null || location.isBlank()) {
            throw new DemoDownloadException("The demo server redirected without saying where");
        }
        try {
            return from.resolve(location.trim());
        } catch (IllegalArgumentException e) {
            throw invalidAddress();
        }
    }

    private static URI parse(String url) {
        if (url == null || url.isBlank()) {
            throw invalidAddress();
        }
        try {
            URI uri = new URI(url.trim());
            requireHttp(uri);
            return uri;
        } catch (URISyntaxException e) {
            throw invalidAddress();
        }
    }

    private static void requireHttp(URI uri) {
        String scheme = uri.getScheme();
        boolean http = "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
        if (!http || uri.getHost() == null) {
            throw invalidAddress();
        }
    }

    private static DemoDownloadRejectedException invalidAddress() {
        return new DemoDownloadRejectedException("Demo download rejected: the demo address is not a valid http or https URL.");
    }

    private static int millis(Duration duration) {
        return (int) Math.min(Integer.MAX_VALUE, duration.toMillis());
    }
}
