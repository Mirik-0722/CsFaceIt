package io.csfaceit.backend.demo;

import io.csfaceit.backend.faceit.FaceitProperties;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import okhttp3.ConnectionPool;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Fetches a demo and turns it into the form that is stored: a zstd file, whatever the demo came as (see
 * {@link DemoFiles}). Nothing is held in memory beyond a copy buffer, nothing is trusted about the size the server
 * announces, and every temporary file is deleted when a method fails.
 */
@Component
public class DemoDownloader {

    private static final Logger log = LoggerFactory.getLogger(DemoDownloader.class);

    /** FACEIT refuses these for good: no access, or no such demo. Asking again changes nothing. */
    private static final Set<Integer> REJECTED_STATUSES = Set.of(401, 403, 404, 410);

    private static final Set<Integer> REDIRECT_STATUSES = Set.of(301, 302, 303, 307, 308);
    private static final int MAX_REDIRECTS = 5;

    /** Where an address that is fetched came from; it decides what a refusal or an unknown host means. */
    private enum Source {
        /** The signed address FACEIT's Downloads API gave: a refusal by it is not about access to the Downloads API. */
        SIGNED_ADDRESS,
        /** The {@code demo_url} of a match, fetched as it is: FACEIT's private cloud when it is refused or unknown. */
        DEMO_URL
    }

    private final DemoDownloadProperties properties;
    private final DemoLinkProperties linkProperties;
    private final LinkGuard linkGuard;

    /**
     * The client of the pasted links: it follows no redirect itself, uses no proxy (a proxy would look the name up on its
     * own), keeps no connection for later and does not unpack a compressed answer. Each download gets a copy whose
     * name lookup answers only the addresses {@link LinkGuard} checked.
     */
    private final OkHttpClient linkClient;

    /**
     * The host of {@code faceit.base-url}, resolved as a control when the host of a demo does not resolve (see
     * {@link #downloadFaceitAddress}); null when that address has no host.
     */
    private final String controlHost;

    public DemoDownloader(DemoDownloadProperties properties, FaceitProperties faceit,
                          DemoLinkProperties linkProperties, LinkGuard linkGuard) {
        this.properties = properties;
        this.controlHost = hostOf(faceit.baseUrl());
        this.linkProperties = linkProperties;
        this.linkGuard = linkGuard;
        this.linkClient = new OkHttpClient.Builder()
                .followRedirects(false)
                .followSslRedirects(false)
                .proxy(Proxy.NO_PROXY)
                .connectionPool(new ConnectionPool(0, 1, TimeUnit.SECONDS))
                .retryOnConnectionFailure(false)
                .connectTimeout(properties.connectTimeout())
                .readTimeout(properties.readTimeout())
                .build();
    }

    /**
     * Downloads the demo into a temporary file in the system temp directory and normalizes it to zstd. Only
     * {@code http} and {@code https} addresses are used, also when the server redirects. The caller owns the
     * returned file and deletes it. This is for the signed address that FACEIT's Downloads API gives: it was handed to
     * this site on purpose, so a refusal by it (it has expired, or FACEIT withdrew it) is not a matter of access to the
     * Downloads API and says so.
     *
     * @throws DemoDownloadRejectedException the download will never work: the server refuses it (HTTP 401, 403, 404
     *         or 410), the file is too large, or the address is not usable
     * @throws DemoDownloadException any other failure; trying again may work
     */
    public Path download(String url) {
        return download(url, Source.SIGNED_ADDRESS);
    }

    /**
     * Like {@link #download(String)}, for the {@code demo_url} of a match fetched as it is, with no access to FACEIT's
     * Downloads API. That address is FACEIT's private cloud: it either does not resolve for anyone outside it, or
     * refuses with HTTP 401 or 403. Neither can change by asking again, so both are the rejection
     * {@link DemoDownloadRejectedException#needsAccess()} and not a failure to retry. Any other host that really serves
     * the file is downloaded as usual.
     *
     * <p>A host that does not resolve is FACEIT's private cloud only when name resolution works: the lookup of the host
     * of {@code faceit.base-url} is made as a control, and only after the demo's host has failed. If the control fails
     * too, the server has no DNS at the moment and nothing can be said of the demo's host, so the failure is the
     * transient {@link DemoDownloadException} that the queue tries again.
     */
    public Path downloadFaceitAddress(String url) {
        return download(url, Source.DEMO_URL);
    }

    /**
     * Downloads the demo behind a link that a player pasted, and normalizes it like {@link #download(String)}. The link
     * and every address a redirect leads to pass {@link LinkGuard} before anything connects to them, and the connection
     * goes to the addresses that were checked: the name is not looked up a second time. At most
     * {@code demo.link.max-duration} is spent on the whole download, redirects included, on top of the size and stall
     * limits of every download.
     *
     * <p>Nothing of the link reaches a message that is kept: it can carry a signature. The sentences of the exceptions
     * thrown here hold no address; for a failure of the connection only the class of the exception is said, and the
     * exception is not kept as the cause (a failed import message is dead-lettered with its stack trace). A refused
     * host is logged, its name only.
     *
     * @throws DemoDownloadRejectedException the download will never work: a refused address (also of a redirect), an
     *         answer 401, 403, 404 or 410, too many redirects, a file too large or a download that takes too long
     * @throws DemoDownloadException any other failure, which trying again may get past (the host does not resolve,
     *         the connection fails or stalls, a server error)
     */
    public Path downloadLink(URI link) {
        Path downloaded = DemoFiles.createTempFile();
        boolean done = false;
        try {
            fetchLink(link, downloaded);
            Path normalized = DemoFiles.normalize(downloaded, properties.maxSize());
            done = true;
            return normalized;
        } finally {
            if (!done) {
                DemoFiles.deleteQuietly(downloaded);
            }
        }
    }

    private void fetchLink(URI link, Path target) {
        long deadline = System.nanoTime() + linkProperties.maxDuration().toNanos();
        URI uri = link;
        for (int redirects = 0; ; redirects++) {
            LinkGuard.CheckedHop hop = checkHop(uri, redirects);
            long left = deadline - System.nanoTime();
            // OkHttp rounds the call timeout down to whole milliseconds and reads 0 as no timeout at all.
            if (left < 1_000_000) {
                throw tookTooLong();
            }
            HttpUrl url = HttpUrl.parse(hop.uri().toASCIIString());
            if (url == null || !url.host().equals(hop.host()) || url.port() != hop.port()) {
                // OkHttp reads the address differently from java.net.URI; whatever it would connect to was not checked.
                throw invalidAddress();
            }
            OkHttpClient client = linkClient.newBuilder()
                    .dns(onlyChecked(hop))
                    .callTimeout(Duration.ofNanos(left))
                    .build();
            Request request = new Request.Builder()
                    .url(url)
                    .header("Accept", "*/*")
                    // The file as it is stored there: OkHttp would otherwise ask for gzip and unpack it on its own.
                    .header("Accept-Encoding", "identity")
                    .build();
            try (Response response = client.newCall(request).execute()) {
                int status = response.code();
                if (REDIRECT_STATUSES.contains(status)) {
                    if (redirects == MAX_REDIRECTS) {
                        throw new DemoDownloadRejectedException(
                                "Demo download rejected: the demo link redirects too many times.");
                    }
                    uri = redirectTarget(uri, response.header("Location"));
                    continue;
                }
                if (REJECTED_STATUSES.contains(status)) {
                    throw new DemoDownloadRejectedException("Demo download rejected: the demo link answered HTTP "
                            + status + ". It may have expired: paste a new link, or upload the .dem manually.");
                }
                if (status < 200 || status >= 300) {
                    throw new DemoDownloadException("The demo link answered HTTP " + status);
                }
                ResponseBody body = response.body();
                if (body == null) {
                    throw new DemoDownloadException("The demo link answered without a body");
                }
                if (body.contentLength() > properties.maxSize().toBytes()) {
                    throw DemoFiles.tooLarge(properties.maxSize());
                }
                long size;
                try (InputStream in = body.byteStream(); OutputStream out = Files.newOutputStream(target)) {
                    size = DemoFiles.copyBounded(in, out, properties.maxSize());
                }
                if (size == 0) {
                    throw new DemoDownloadException("The demo link sent an empty file");
                }
                return;
            } catch (IOException e) {
                if (System.nanoTime() - deadline >= 0) {
                    throw tookTooLong();
                }
                // The class only: the message of a connection failure can hold the host, the address or the link.
                throw new DemoDownloadException("The demo could not be downloaded from the link: "
                        + e.getClass().getName());
            }
        }
    }

    /**
     * Runs {@link LinkGuard} on one address of a pasted link. A refusal is final (the demo FAILS with a sentence that
     * names nothing) and the host is logged; a host that does not resolve may be a passing failure of the lookups.
     */
    private LinkGuard.CheckedHop checkHop(URI uri, int redirects) {
        try {
            return linkGuard.check(uri);
        } catch (DemoLinkRefusedException e) {
            log.warn("Refused to download a demo link ({}): {} [{}]",
                    redirects == 0 ? "the link itself" : "after " + redirects + " redirect(s)", e.getMessage(),
                    e.getCode());
            throw new DemoDownloadRejectedException("Demo download rejected: the demo link, or an address it "
                    + "redirects to, is not one this site downloads from. Upload the .dem manually.");
        } catch (UnknownHostException e) {
            throw new DemoDownloadException("The host of the demo link does not resolve");
        }
    }

    /** A name lookup that knows one name, the one that was checked, and answers the addresses that were checked. */
    private static Dns onlyChecked(LinkGuard.CheckedHop hop) {
        return hostname -> {
            if (!hostname.equals(hop.host())) {
                throw new UnknownHostException("Not the host that was checked");
            }
            return hop.addresses();
        };
    }

    private DemoDownloadRejectedException tookTooLong() {
        return new DemoDownloadRejectedException("Demo download rejected: the download from the demo link took longer "
                + "than " + linkProperties.maxDuration().toMinutes() + " minutes. Upload the .dem manually.");
    }

    private Path download(String url, Source source) {
        URI uri = parse(url);
        Path downloaded = DemoFiles.createTempFile();
        boolean done = false;
        try {
            fetch(uri, downloaded, source);
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
    private void fetch(URI start, Path target, Source source) {
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
                    throw switch (source) {
                        case SIGNED_ADDRESS -> DemoDownloadRejectedException.signedAddressRefused(status);
                        case DEMO_URL -> status == 401 || status == 403
                                ? DemoDownloadRejectedException.needsAccess()
                                : DemoDownloadRejectedException.forStatus(status);
                    };
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
                if (source == Source.DEMO_URL && e instanceof UnknownHostException) {
                    throw unknownDemoHost(e);
                }
                throw new DemoDownloadException("The demo could not be downloaded: " + e, e);
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }
    }

    /**
     * The host of a demo address did not resolve. If a control host resolves, name resolution works and the host is
     * really unknown, which for a FACEIT demo address means its private cloud; if the control does not resolve either,
     * the lookups themselves are failing, and trying again later may work.
     */
    private DemoDownloadException unknownDemoHost(IOException cause) {
        if (controlHost == null || resolves(controlHost)) {
            return DemoDownloadRejectedException.needsAccess();
        }
        return new DemoDownloadException("The demo host does not resolve, and neither does the control host: "
                + "name resolution looks down", cause);
    }

    private static boolean resolves(String host) {
        try {
            InetAddress.getByName(host);
            return true;
        } catch (UnknownHostException e) {
            return false;
        }
    }

    private static String hostOf(String address) {
        try {
            return address == null ? null : URI.create(address).getHost();
        } catch (IllegalArgumentException e) {
            return null;
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
