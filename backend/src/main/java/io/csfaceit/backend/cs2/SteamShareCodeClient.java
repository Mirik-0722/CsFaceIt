package io.csfaceit.backend.cs2;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Asks Steam's Web API for the match sharing code that follows a known one in a player's CS2 matchmaking history:
 * {@code GET <cs2.steam-api-url>/ICSGOPlayers_730/GetNextMatchSharingCode/v1?key=…&steamid=…&steamidkey=…&knowncode=…}.
 * Steam answers 200 with {@code {"result":{"nextcode":"CSGO-…"}}} when there is a newer match, 202 with {@code n/a} as
 * the code when there is none yet, 403 when the authentication code ({@code steamidkey}) is refused (or the site's key:
 * told apart by a second call, see {@link #nextCode(String, String, String, KeyCheck)}), 412 when the known code is not
 * one of this player's, and 429 when the site asks too often.
 *
 * <p>The query holds the site's API key and the player's authentication code, both secrets, so the address of a call is
 * never logged and never put into an exception or an answer: the JDK's HTTP client is used directly, whose exceptions
 * do not quote the address (Spring's REST client puts it into the message of its own), and of a failure only the class
 * of the exception and Steam's HTTP status are logged.
 *
 * <p>Calls are paced for the whole process, the walk's and the link request's together: one call starts at least one
 * second after the one before it.
 */
@Component
public class SteamShareCodeClient {

    /** What Steam's answer means for the link. */
    public enum Outcome {
        /** There is a newer match: {@link Answer#nextCode} is its code. */
        NEXT,
        /** There is no newer match yet (202, {@code n/a}). */
        NONE,
        /** Steam refused the authentication code (403, and the site's key is good). */
        AUTH_CODE_REFUSED,
        /** Steam refused the site's key ({@code STEAM_WEB_API_KEY}): nothing can be said about the player's codes. */
        KEY_REFUSED,
        /** The known code is not one of this player's (412). */
        SHARE_CODE_REFUSED,
        /** Steam says the site asks too often (429). */
        RATE_LIMITED,
        /** Steam failed (5xx, another status, an unusable answer) or did not answer in time; asking later may work. */
        UNAVAILABLE
    }

    /**
     * Steam's answer.
     *
     * @param nextCode the newer code, for {@link Outcome#NEXT} only
     * @param answered whether Steam answered at all (any HTTP status), as opposed to a timeout or a connection failure
     */
    public record Answer(Outcome outcome, String nextCode, boolean answered) {

        static Answer of(Outcome outcome) {
            return new Answer(outcome, null, true);
        }
    }

    private static final String PATH = "/ICSGOPlayers_730/GetNextMatchSharingCode/v1";
    /** A call that needs the site's key and nothing else, to tell a refused key from a refused authentication code. */
    private static final String KEY_CHECK_PATH = "/ISteamUser/GetPlayerSummaries/v2";
    private static final String NO_CODE = "n/a";
    private static final long MIN_GAP_NANOS = Duration.ofSeconds(1).toNanos();

    private static final Logger log = LoggerFactory.getLogger(SteamShareCodeClient.class);

    private final Cs2Properties properties;
    private final ObjectMapper mapper;
    private final String base;
    private final HttpClient http;

    private final Object paceLock = new Object();
    private long nextCallAt = System.nanoTime();

    public SteamShareCodeClient(Cs2Properties properties, ObjectMapper mapper) {
        this.properties = properties;
        this.mapper = mapper;
        this.base = baseOf(properties.steamApiUrl());
        // HTTP/1.1 as for FACEIT: the JDK client otherwise tries an h2c upgrade, which WireMock does not handle.
        this.http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.steamTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    /**
     * Asks for the code after {@code knownCode}, with a key check of its own (see {@link #nextCode(String, String,
     * String, KeyCheck)}). Never throws: a failure of any kind is {@link Outcome#UNAVAILABLE}.
     */
    public Answer nextCode(String steamId, String authCode, String knownCode) {
        return nextCode(steamId, authCode, knownCode, new KeyCheck());
    }

    /**
     * Asks for the code after {@code knownCode}. Never throws: a failure of any kind is {@link Outcome#UNAVAILABLE}.
     *
     * <p>Steam answers 403 both for a refused authentication code and for a refused key of the site. So a 403 is taken
     * for the authentication code only once the key is known to be good: a 403 whose body names the {@code key=}
     * parameter (Steam's page for a bad key) is {@link Outcome#KEY_REFUSED} at once; otherwise the key is checked with a
     * call that needs nothing but the key ({@code ISteamUser/GetPlayerSummaries/v2} for the same SteamID, paced like the
     * others), whose good answer {@code keyCheck} keeps. A check that cannot tell (Steam fails there too) is
     * {@link Outcome#UNAVAILABLE}: nothing is decided on a guess.
     *
     * @param steamId the player's SteamID64
     * @param authCode the player's authentication code, opened just for this call
     * @param knownCode the last code known of the player
     * @param keyCheck what is known of the key in this run (the walk keeps one per run; a link request has its own)
     */
    public Answer nextCode(String steamId, String authCode, String knownCode, KeyCheck keyCheck) {
        HttpResponse<byte[]> response = get(PATH
                + "?key=" + encode(properties.steamApiKey())
                + "&steamid=" + encode(steamId)
                + "&steamidkey=" + encode(authCode)
                + "&knowncode=" + encode(knownCode), "for the next match sharing code");
        if (response == null) {
            return new Answer(Outcome.UNAVAILABLE, null, false);
        }
        if (response.statusCode() == 403) {
            return refusal(steamId, response.body(), keyCheck);
        }
        return answerOf(response.statusCode(), response.body());
    }

    /** What is known of the site's key within one run: whether a check has already said that it is good. */
    public static final class KeyCheck {

        private boolean keyAccepted;
    }

    /** A 403: the authentication code, unless the key is refused (see {@link #nextCode(String, String, String, KeyCheck)}). */
    private Answer refusal(String steamId, byte[] body, KeyCheck keyCheck) {
        if (namesKey(body)) {
            return Answer.of(Outcome.KEY_REFUSED);
        }
        if (!keyCheck.keyAccepted) {
            HttpResponse<byte[]> check = get(KEY_CHECK_PATH + "?key=" + encode(properties.steamApiKey())
                    + "&steamids=" + encode(steamId), "to check the site's key");
            if (check == null) {
                return Answer.of(Outcome.UNAVAILABLE);
            }
            int status = check.statusCode();
            if (status == 401 || status == 403) {
                return Answer.of(Outcome.KEY_REFUSED);
            }
            if (status != 200) {
                log.warn("Steam answered HTTP {} to the check of the site's key", status);
                return Answer.of(Outcome.UNAVAILABLE);
            }
            keyCheck.keyAccepted = true;
        }
        return Answer.of(Outcome.AUTH_CODE_REFUSED);
    }

    /** Whether Steam's page of a 403 names the key parameter, as its page for a refused key does. */
    private static boolean namesKey(byte[] body) {
        return body != null && new String(body, 0, Math.min(body.length, 8192), StandardCharsets.UTF_8).contains("key=");
    }

    /**
     * One paced GET of Steam's Web API. Never throws.
     *
     * @return the answer, or null when Steam could not be asked or did not answer in time
     */
    private HttpResponse<byte[]> get(String pathAndQuery, String what) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(base + pathAndQuery))
                    .timeout(properties.steamTimeout())
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            pace();
            return http.send(request, HttpResponse.BodyHandlers.ofByteArray());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } catch (IOException | RuntimeException e) {
            // Only the class: a message could quote what the request was made of.
            log.warn("Steam could not be asked {}: {}", what, e.getClass().getSimpleName());
            return null;
        }
    }

    private Answer answerOf(int status, byte[] body) {
        switch (status) {
            case 200, 202 -> {
                String code = nextCodeIn(body);
                if (status == 202 || NO_CODE.equalsIgnoreCase(code)) {
                    return Answer.of(Outcome.NONE);
                }
                if (ShareCode.isWellFormed(code)) {
                    return new Answer(Outcome.NEXT, code, true);
                }
                log.warn("Steam answered HTTP 200 without a usable match sharing code");
                return Answer.of(Outcome.UNAVAILABLE);
            }
            case 412 -> {
                return Answer.of(Outcome.SHARE_CODE_REFUSED);
            }
            case 429 -> {
                return Answer.of(Outcome.RATE_LIMITED);
            }
            default -> {
                log.warn("Steam answered HTTP {} to the question for the next match sharing code", status);
                return Answer.of(Outcome.UNAVAILABLE);
            }
        }
    }

    /** {@code result.nextcode} of the answer, or null when the answer is not JSON or has none. */
    private String nextCodeIn(byte[] body) {
        try {
            JsonNode code = mapper.readTree(body).path("result").path("nextcode");
            return code.isTextual() ? code.textValue().trim() : null;
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    /** Waits until a second has passed since the last call of the process started, then lets this one start. */
    private void pace() throws InterruptedException {
        synchronized (paceLock) {
            long wait = nextCallAt - System.nanoTime();
            if (wait > 0) {
                Thread.sleep(wait / 1_000_000, (int) (wait % 1_000_000));
            }
            nextCallAt = System.nanoTime() + MIN_GAP_NANOS;
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    /**
     * The base address without a trailing slash; blank is Steam's own, and a setting that is not an http or https address
     * stops the start.
     */
    private static String baseOf(String url) {
        if (!Cs2Properties.isSet(url)) {
            return Cs2Properties.DEFAULT_STEAM_API_URL;
        }
        try {
            URI uri = URI.create(url.trim());
            String scheme = uri.getScheme();
            if (uri.getHost() != null && ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) {
                String text = uri.toString();
                return text.endsWith("/") ? text.substring(0, text.length() - 1) : text;
            }
        } catch (IllegalArgumentException | NullPointerException e) {
            // Reported below.
        }
        throw new IllegalStateException("cs2.steam-api-url (CS2_STEAM_API_URL) must be an http or https address");
    }
}
