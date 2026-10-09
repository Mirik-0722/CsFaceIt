package io.csfaceit.backend.demo;

import com.github.luben.zstd.ZstdOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Set;
import java.util.zip.GZIPInputStream;
import org.springframework.stereotype.Component;
import org.springframework.util.unit.DataSize;

/**
 * Fetches a demo and turns it into the form that is stored: a zstd file, whatever the demo came as. Nothing is held
 * in memory beyond a copy buffer, nothing is trusted about the size the server announces, and every temporary file
 * is deleted when a method fails.
 */
@Component
public class DemoDownloader {

    /** FACEIT refuses these for good: no access, or no such demo. Asking again changes nothing. */
    private static final Set<Integer> REJECTED_STATUSES = Set.of(401, 403, 404, 410);

    private static final Set<Integer> REDIRECT_STATUSES = Set.of(301, 302, 303, 307, 308);
    private static final int MAX_REDIRECTS = 5;

    private static final int BUFFER_SIZE = 64 * 1024;
    private static final int ZSTD_LEVEL = 3;

    private static final byte[] GZIP_MAGIC = {0x1f, (byte) 0x8b};
    private static final byte[] ZSTD_MAGIC = {0x28, (byte) 0xb5, 0x2f, (byte) 0xfd};

    private final DemoDownloadProperties properties;

    public DemoDownloader(DemoDownloadProperties properties) {
        this.properties = properties;
    }

    /**
     * Downloads the demo into a temporary file in the system temp directory and normalizes it to zstd. Only
     * {@code http} and {@code https} addresses are used, also when the server redirects. The caller owns the
     * returned file and deletes it.
     *
     * @throws DemoDownloadRejectedException the download will never work: FACEIT refuses it (HTTP 401, 403, 404 or
     *         410), the file is too large, or the address is not usable
     * @throws DemoDownloadException any other failure; trying again may work
     */
    public Path download(String url) {
        URI uri = parse(url);
        Path downloaded = createTempFile();
        boolean done = false;
        try {
            fetch(uri, downloaded);
            Path normalized = normalize(downloaded);
            done = true;
            return normalized;
        } finally {
            if (!done) {
                deleteQuietly(downloaded);
            }
        }
    }

    /**
     * Brings a demo file to zstd, by its first bytes and not by its name: zstd is kept as it is, gzip is unpacked and
     * compressed again, anything else is taken for a raw demo and compressed. The result is either {@code source}
     * itself or a new temporary file, in which case {@code source} is deleted; when this method fails, {@code source}
     * is left for the caller to delete. A demo that expands beyond the maximum size is refused.
     *
     * @return the zstd file; the caller deletes it
     */
    public Path normalize(Path source) {
        try {
            byte[] head = readHead(source);
            if (startsWith(head, ZSTD_MAGIC)) {
                return source;
            }
            boolean gzip = startsWith(head, GZIP_MAGIC);
            Path target = createTempFile();
            try (InputStream file = Files.newInputStream(source);
                 InputStream in = gzip ? new GZIPInputStream(file, BUFFER_SIZE) : file;
                 OutputStream targetFile = Files.newOutputStream(target);
                 OutputStream out = new ZstdOutputStream(targetFile, ZSTD_LEVEL)) {
                copyBounded(in, out);
            } catch (IOException | RuntimeException e) {
                deleteQuietly(target);
                throw e;
            }
            deleteQuietly(source);
            return target;
        } catch (IOException e) {
            throw new DemoDownloadException("The demo file could not be compressed", e);
        }
    }

    /** Follows the redirects itself so that each hop is checked to be an http or https address. */
    private void fetch(URI start, Path target) {
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
                    throw DemoDownloadRejectedException.forStatus(status);
                }
                if (status < 200 || status >= 300) {
                    throw new DemoDownloadException("The demo server answered HTTP " + status);
                }
                if (connection.getContentLengthLong() > maxBytes()) {
                    throw tooLarge();
                }
                long size;
                try (InputStream in = connection.getInputStream(); OutputStream out = Files.newOutputStream(target)) {
                    size = copyBounded(in, out);
                }
                if (size == 0) {
                    throw new DemoDownloadException("The demo server sent an empty file");
                }
                return;
            } catch (IOException e) {
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

    /** Copies at most the maximum size, counting what really arrives instead of believing a length header. */
    private long copyBounded(InputStream in, OutputStream out) throws IOException {
        long limit = maxBytes();
        byte[] buffer = new byte[BUFFER_SIZE];
        long total = 0;
        int read;
        while ((read = in.read(buffer)) != -1) {
            total += read;
            if (total > limit) {
                throw tooLarge();
            }
            out.write(buffer, 0, read);
        }
        return total;
    }

    private long maxBytes() {
        return properties.maxSize().toBytes();
    }

    private DemoDownloadRejectedException tooLarge() {
        return new DemoDownloadRejectedException(
                "Demo download rejected: the file is larger than the allowed " + describe(properties.maxSize()) + ".");
    }

    /** "1 GB", "512 MB", "2 KB" or "700 bytes": the largest unit that divides the size exactly. */
    private static String describe(DataSize size) {
        long bytes = size.toBytes();
        String[] names = {"GB", "MB", "KB"};
        DataSize[] units = {DataSize.ofGigabytes(1), DataSize.ofMegabytes(1), DataSize.ofKilobytes(1)};
        for (int i = 0; i < units.length; i++) {
            long unit = units[i].toBytes();
            if (bytes >= unit && bytes % unit == 0) {
                return bytes / unit + " " + names[i];
            }
        }
        return bytes + " bytes";
    }

    private static DemoDownloadRejectedException invalidAddress() {
        return new DemoDownloadRejectedException("Demo download rejected: the demo address is not a valid http or https URL.");
    }

    private static byte[] readHead(Path file) throws IOException {
        try (InputStream in = Files.newInputStream(file)) {
            return in.readNBytes(ZSTD_MAGIC.length);
        }
    }

    private static boolean startsWith(byte[] bytes, byte[] prefix) {
        if (bytes.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (bytes[i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    private static Path createTempFile() {
        try {
            return Files.createTempFile("demo-", ".part");
        } catch (IOException e) {
            throw new DemoDownloadException("A temporary file for the demo could not be created", e);
        }
    }

    private static void deleteQuietly(Path file) {
        try {
            Files.deleteIfExists(file);
        } catch (IOException ignored) {
            // Nothing more can be done about a file that cannot be deleted; the OS cleans the temp directory.
        }
    }

    private static int millis(Duration duration) {
        return (int) Math.min(Integer.MAX_VALUE, duration.toMillis());
    }
}
