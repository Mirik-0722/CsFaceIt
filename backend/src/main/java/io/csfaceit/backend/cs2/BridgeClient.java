package io.csfaceit.backend.cs2;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Asks the bridge to the CS2 game coordinator ({@code gcbridge/}, see its README) where the replay of the match of a
 * sharing code is: {@code POST <cs2.bridge-url>/resolve} with {@code {"shareCode": "CSGO-…"}} and the header
 * {@code X-Bridge-Token}. Its answers: 200 {@code {matchId, replayUrl, matchTime}}; 409 {@code REPLAY_NOT_READY} (Valve
 * publishes the file some minutes after the match; the bridge turns it into 410 after two hours); 410
 * {@code REPLAY_EXPIRED}; 404 {@code MATCH_UNKNOWN}; 401 for a wrong token; 429 {@code BUSY} and 503
 * {@code GC_UNAVAILABLE}, which mean "later".
 *
 * <p>The token is a secret, so it is never logged or put into a message; of a failure only the HTTP status or the class
 * of the exception is logged. The JDK's HTTP client is used directly, as for Steam.
 */
@Component
public class BridgeClient {

    /** What the bridge's answer means for the match of the code. */
    public enum Outcome {
        /** The match and its replay address: {@link Resolution#matchId}, {@link Resolution#replayUrl}. */
        RESOLVED,
        /** The match is known and its replay is not there yet (409). */
        NOT_READY,
        /** The match is known and its replay is gone (410). */
        EXPIRED,
        /** The game coordinator knows no such match (404), or the bridge cannot read the code at all (400). */
        UNKNOWN,
        /** The bridge refused the site's token (401). */
        UNAUTHORIZED,
        /** The bridge is busy or the coordinator unavailable (429, 503), the bridge failed, or did not answer in time. */
        UNAVAILABLE
    }

    /**
     * The bridge's answer.
     *
     * @param matchId Valve's match id in decimal, for {@link Outcome#RESOLVED}
     * @param replayUrl where the replay file is, for {@link Outcome#RESOLVED}
     * @param matchTime when the match was played, when the bridge said so (200, 409, 410); otherwise null
     */
    public record Resolution(Outcome outcome, String matchId, String replayUrl, Instant matchTime) {

        static Resolution of(Outcome outcome) {
            return new Resolution(outcome, null, null, null);
        }
    }

    static final String TOKEN_HEADER = "X-Bridge-Token";

    private static final Logger log = LoggerFactory.getLogger(BridgeClient.class);

    private final Cs2Properties properties;
    private final ObjectMapper mapper;
    private final URI resolveUri;
    private final HttpClient http;

    public BridgeClient(Cs2Properties properties, ObjectMapper mapper) {
        this.properties = properties;
        this.mapper = mapper;
        this.resolveUri = Cs2Properties.isSet(properties.bridgeUrl()) ? resolveUriOf(properties) : null;
        this.http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.bridgeTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    /** Asks for the match of the code. Never throws: a failure of any kind is {@link Outcome#UNAVAILABLE}. */
    public Resolution resolve(String shareCode) {
        if (resolveUri == null) {
            return Resolution.of(Outcome.UNAVAILABLE);
        }
        HttpResponse<byte[]> response;
        try {
            HttpRequest request = HttpRequest.newBuilder(resolveUri)
                    .timeout(properties.bridgeTimeout())
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .header(TOKEN_HEADER, properties.bridgeToken().trim())
                    .POST(HttpRequest.BodyPublishers.ofByteArray(
                            mapper.writeValueAsBytes(Map.of("shareCode", shareCode))))
                    .build();
            response = http.send(request, HttpResponse.BodyHandlers.ofByteArray());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Resolution.of(Outcome.UNAVAILABLE);
        } catch (IOException | RuntimeException e) {
            // Only the class: the JDK names an invalid header value, the token, in the message of its exception.
            log.warn("The bridge to the game coordinator could not be asked: {}", e.getClass().getSimpleName());
            return Resolution.of(Outcome.UNAVAILABLE);
        }
        return resolutionOf(response.statusCode(), response.body());
    }

    private Resolution resolutionOf(int status, byte[] body) {
        switch (status) {
            case 200 -> {
                JsonNode answer = read(body);
                String matchId = text(answer, "matchId");
                String replayUrl = text(answer, "replayUrl");
                if (matchId == null || !matchId.chars().allMatch(Character::isDigit) || replayUrl == null) {
                    log.warn("The bridge answered HTTP 200 without a match id and a replay address");
                    return Resolution.of(Outcome.UNAVAILABLE);
                }
                return new Resolution(Outcome.RESOLVED, matchId, replayUrl, instant(text(answer, "matchTime")));
            }
            case 409 -> {
                return new Resolution(Outcome.NOT_READY, null, null, instant(text(read(body), "matchTime")));
            }
            case 410 -> {
                return new Resolution(Outcome.EXPIRED, null, null, instant(text(read(body), "matchTime")));
            }
            case 400, 404 -> {
                return Resolution.of(Outcome.UNKNOWN);
            }
            case 401 -> {
                return Resolution.of(Outcome.UNAUTHORIZED);
            }
            case 429, 503 -> {
                return Resolution.of(Outcome.UNAVAILABLE);
            }
            default -> {
                log.warn("The bridge to the game coordinator answered HTTP {}", status);
                return Resolution.of(Outcome.UNAVAILABLE);
            }
        }
    }

    private JsonNode read(byte[] body) {
        try {
            return mapper.readTree(body);
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    private static String text(JsonNode answer, String field) {
        if (answer == null) {
            return null;
        }
        JsonNode value = answer.path(field);
        return value.isTextual() && !value.textValue().isBlank() ? value.textValue().trim() : null;
    }

    private static Instant instant(String text) {
        if (text == null) {
            return null;
        }
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    /**
     * The address of {@code /resolve}. A bridge needs its token, and its address has to be http or https; either problem
     * stops the start, with a message that names the variables and not their values.
     */
    private static URI resolveUriOf(Cs2Properties properties) {
        if (!Cs2Properties.isSet(properties.bridgeToken())) {
            throw new IllegalStateException("CS2_BRIDGE_TOKEN is required when CS2_BRIDGE_URL is set: the bridge refuses "
                    + "every call without the token it was given as BRIDGE_TOKEN");
        }
        try {
            URI uri = URI.create(properties.bridgeUrl().trim());
            String scheme = uri.getScheme();
            if (uri.getHost() != null && ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) {
                String text = uri.toString();
                return URI.create((text.endsWith("/") ? text.substring(0, text.length() - 1) : text) + "/resolve");
            }
        } catch (IllegalArgumentException e) {
            // Reported below.
        }
        throw new IllegalStateException("cs2.bridge-url (CS2_BRIDGE_URL) must be an http or https address, such as "
                + "http://gcbridge:8090");
    }
}
