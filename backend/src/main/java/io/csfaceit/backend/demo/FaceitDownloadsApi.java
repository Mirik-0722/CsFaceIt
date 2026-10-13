package io.csfaceit.backend.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.faceit.FaceitProperties;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

/**
 * FACEIT's Downloads API: the only way to get a demo file, because the {@code demo_url} of a match is a private cloud
 * address that nothing outside FACEIT can reach. {@code POST <faceit.downloads.url>} with the bearer token of
 * {@code faceit.downloads.token} and the body {@code {"resource_url": "<demo_url>"}} answers
 * {@code {"payload": {"download_url": "<signed address>"}}}, and the file is then fetched from that address by
 * {@link DemoDownloader}. The token is a separate access token with the Downloads API scope, applied for at FACEIT; the
 * Data API key is refused here with HTTP 403.
 *
 * <p>The call is made once per attempt of the import and has the timeouts of the other FACEIT calls; it is not retried
 * here, the queue retries what throws {@link DemoDownloadException}. The token, the endpoint and the signed address
 * are never logged and never put in an exception message, because {@code demos.error} shows those messages and the
 * signed address is a bearer credential for the file: only the host of the signed address is logged, once. The signed
 * address is not stored anywhere either; it lives for the length of one import.
 */
@Component
public class FaceitDownloadsApi {

    private static final Logger log = LoggerFactory.getLogger(FaceitDownloadsApi.class);

    /** The answer is a few hundred bytes; a bigger one is not what the Downloads API sends. */
    private static final int MAX_ANSWER_BYTES = 64 * 1024;

    private final FaceitProperties.Downloads settings;
    private final URI endpoint;
    private final RestClient client;
    private final ObjectMapper mapper;

    public FaceitDownloadsApi(FaceitProperties properties, ObjectMapper mapper) {
        this.settings = properties.downloads();
        this.mapper = mapper;
        this.endpoint = settings.configured() ? endpointOf(settings.url()) : null;
        // HTTP/1.1 is forced like for the Data API: the JDK client otherwise tries an h2c upgrade, which WireMock does not
        // handle. The timeouts are those of the other FACEIT calls.
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.connectTimeout())
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(properties.readTimeout());
        this.client = RestClient.builder().requestFactory(requestFactory).build();
    }

    /** Whether the site has a token for the Downloads API; without one the import fetches {@code demo_url} itself. */
    public boolean isConfigured() {
        return endpoint != null;
    }

    /**
     * Asks for the signed address to download the demo from.
     *
     * @param demoUrl the {@code demo_url} of the match
     * @return the signed address; it is a secret of this import, never to be logged or stored
     * @throws DemoDownloadRejectedException the file will not be had by asking again: the token is refused (HTTP 401 or
     *         403, with {@link DemoErrorCode#DOWNLOAD_NEEDS_ACCESS}), FACEIT has no such demo (404) or refuses the request
     *         (another 4xx), or the answer holds no {@code payload.download_url}
     * @throws DemoDownloadException FACEIT failed (5xx, 429, an unexpected status), did not answer or could not be reached;
     *         trying again may work
     */
    public String signedAddress(String demoUrl) {
        if (!isConfigured()) {
            throw new IllegalStateException("There is no token for the FACEIT Downloads API");
        }
        Answer answer;
        try {
            answer = client.post()
                    .uri(endpoint)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + settings.token())
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON)
                    .body(Map.of("resource_url", demoUrl))
                    .exchange((request, response) -> {
                        int status = response.getStatusCode().value();
                        byte[] body = status >= 200 && status < 300
                                ? response.getBody().readNBytes(MAX_ANSWER_BYTES) : new byte[0];
                        return new Answer(status, body);
                    });
        } catch (ResourceAccessException e) {
            // The message of RestClient's own exception names the endpoint, so only the kind of failure is passed on.
            Throwable cause = e.getMostSpecificCause();
            throw new DemoDownloadException("The FACEIT Downloads API could not be reached: "
                    + cause.getClass().getSimpleName());
        }
        return signedAddressOf(answer);
    }

    private String signedAddressOf(Answer answer) {
        int status = answer.status();
        if (status == 401 || status == 403) {
            throw DemoDownloadRejectedException.needsAccess();
        }
        if (status == 404) {
            throw new DemoDownloadRejectedException("Demo download rejected: FACEIT has no file to download for this demo.");
        }
        if (status == 429 || status >= 500 && status < 600) {
            throw new DemoDownloadException("The FACEIT Downloads API answered HTTP " + status);
        }
        if (status >= 400 && status < 500) {
            throw new DemoDownloadRejectedException(
                    "Demo download rejected: the FACEIT Downloads API refused the request (HTTP " + status + ").");
        }
        if (status < 200 || status >= 300) {
            throw new DemoDownloadException("The FACEIT Downloads API answered HTTP " + status);
        }
        String address = downloadUrlIn(answer.body());
        if (address == null) {
            throw new DemoDownloadRejectedException("Demo download rejected: FACEIT gave no download address for this demo.");
        }
        log.info("FACEIT's Downloads API gave a signed address on {}", hostOf(address));
        return address;
    }

    /** The {@code payload.download_url} of the answer, or null when the answer is not JSON or has none. */
    private String downloadUrlIn(byte[] body) {
        try {
            JsonNode url = mapper.readTree(body).path("payload").path("download_url");
            return url.isTextual() && !url.textValue().isBlank() ? url.textValue().trim() : null;
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    private static String hostOf(String address) {
        try {
            String host = URI.create(address).getHost();
            return host == null ? "an unknown host" : host;
        } catch (IllegalArgumentException e) {
            return "an unknown host";
        }
    }

    /** The endpoint as a URI; the setting is a plain {@code http} or {@code https} address, and its value is not echoed. */
    private static URI endpointOf(String url) {
        try {
            URI uri = URI.create(url);
            String scheme = uri.getScheme();
            if (uri.getHost() != null && ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) {
                return uri;
            }
        } catch (IllegalArgumentException e) {
            // Reported below, without the value.
        }
        throw new IllegalStateException("faceit.downloads.url (FACEIT_DOWNLOADS_URL) must be an http or https address");
    }

    private record Answer(int status, byte[] body) {
    }
}
