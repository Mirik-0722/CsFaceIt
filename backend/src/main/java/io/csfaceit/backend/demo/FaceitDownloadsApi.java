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
 * address is not stored anywhere either; it lives for the length of one import. A refusal of the token (HTTP 401 or 403)
 * is logged with FACEIT's own error code and message, which tell a missing scope from a bad token and are no secret.
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
                        // The body is read for an answer that is used and for a refusal, whose FACEIT error code is logged.
                        byte[] body = new byte[0];
                        if (status >= 200 && status < 300) {
                            // The address is in this body: a body that cannot be read is a failure to try again.
                            body = response.getBody().readNBytes(MAX_ANSWER_BYTES);
                        } else if (status == 401 || status == 403) {
                            try {
                                body = response.getBody().readNBytes(MAX_ANSWER_BYTES);
                            } catch (IOException e) {
                                // The body only tells which refusal this is, for the log. Without it the refusal
                                // stands, logged with no code and no message: a refused token is not tried again.
                            }
                        }
                        return new Answer(status, body);
                    });
        } catch (ResourceAccessException e) {
            // The message of RestClient's own exception names the endpoint, so only the kind of failure is passed on.
            Throwable cause = e.getMostSpecificCause();
            throw new DemoDownloadException("The FACEIT Downloads API could not be reached: "
                    + cause.getClass().getSimpleName());
        } catch (RuntimeException e) {
            // Anything else the request can throw may quote what it was given: the JDK's request builder answers an invalid
            // header value (a token with a character above U+00FF or a control character) with an IllegalArgumentException
            // whose message is `invalid header value: "Bearer <the token>"`. That message would be retried, republished with
            // the exception in its headers and logged, so only the kind of failure is passed on, and the cause is not chained.
            throw new DemoDownloadException("The FACEIT Downloads API could not be asked: " + e.getClass().getSimpleName());
        }
        return signedAddressOf(answer);
    }

    private String signedAddressOf(Answer answer) {
        int status = answer.status();
        if (status == 401 || status == 403) {
            logRefusal(status, answer.body());
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

    /**
     * Logs a refusal with FACEIT's own words, which tell a token that lacks the scope ({@code err_f0}, "no valid scope
     * provided") from a token that is bad or revoked; neither is a secret. The sentence in {@code demos.error} is the same
     * for both. What FACEIT sent is cut short and cleaned of control characters, and left out if it would hold the token.
     */
    private void logRefusal(int status, byte[] body) {
        String code = "none";
        String message = "none";
        try {
            JsonNode first = mapper.readTree(body).path("errors").path(0);
            code = printable(first.path("code").asText(null));
            message = printable(first.path("message").asText(null));
        } catch (IOException | RuntimeException e) {
            // An answer that is not JSON, or has no body at all (see signedAddress), has no code; the status is logged
            // all the same.
        }
        log.warn("FACEIT's Downloads API refused the token: HTTP {}, error code {}, message {}", status, code, message);
    }

    /** A value taken from FACEIT's answer for a log line: at most 200 printable characters, and never the token. */
    private String printable(String value) {
        if (value == null || value.isBlank()) {
            return "none";
        }
        if (settings.configured() && value.contains(settings.token())) {
            return "withheld";
        }
        String clean = value.replaceAll("\\p{Cntrl}", " ").trim();
        return clean.length() > 200 ? clean.substring(0, 200) + "..." : clean;
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
