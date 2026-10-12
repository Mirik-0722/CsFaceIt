package io.csfaceit.backend.auth;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Signing in with Steam by OpenID 2.0, which needs neither an API key nor a registration: the visitor is sent to Steam's
 * login page, proves who they are there, and Steam sends them back with an answer that says which Steam account it
 * was. The answer arrives in the visitor's own request, so it is only as good as the check made of it. Nothing in it is
 * believed until all of these hold, in this order:
 *
 * <ol>
 *   <li>every {@code openid.*} parameter is there once (a parameter sent twice is read one way here and another way by
 *       Steam), and there are not unreasonably many
 *   <li>{@code openid.mode} is {@code id_res}, a positive answer (a visitor who gives up at Steam comes back with
 *       {@code cancel})
 *   <li>{@code openid.return_to} is the address this very request would have been given to send the visitor back to:
 *       the same origin, the same callback, the same {@code state}. An answer made for another site or another sign-in
 *       is therefore not accepted here
 *   <li>{@code openid.op_endpoint} is the login address of the setting
 *   <li>{@code openid.claimed_id} is exactly {@code https://steamcommunity.com/openid/id/} and 17 digits. That
 *       pattern is Steam's own and stays so in every environment, the stack with a fake Steam included
 *   <li>Steam confirms the answer: the parameters are posted back to the verification address of the setting with
 *       {@code openid.mode} changed to {@code check_authentication}, and the reply must hold the line
 *       {@code is_valid:true}. It is Steam that checks the signature of the fields and, as OpenID 2.0 asks of a provider,
 *       does not confirm one answer twice
 * </ol>
 *
 * <p>The confirmation goes to the address of the setting and never to one that the answer names, so an answer made by
 * somebody else's server cannot vouch for itself. It has a short timeout, and a Steam that does not answer is a failed
 * sign-in ({@link SteamLoginRejectedException}), not an error of the site. Every failure says why in a few fixed words
 * and quotes nothing it was given.
 */
@Component
public class SteamOpenId {

    /** The path Steam sends the visitor back to. It is the one callback of the site, whatever the origin. */
    static final String CALLBACK_PATH = "/api/v1/auth/steam/callback";

    private static final String NAMESPACE = "http://specs.openid.net/auth/2.0";
    private static final String IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
    private static final String MODE_REQUEST = "checkid_setup";
    private static final String MODE_POSITIVE = "id_res";
    private static final String MODE_VERIFY = "check_authentication";
    private static final String PARAMETER_PREFIX = "openid.";
    private static final String VALID_LINE = "is_valid:true";

    /** The one shape of Steam's identity: the SteamID64 is the 17 digits. Matched against the whole value. */
    private static final Pattern CLAIMED_ID = Pattern.compile("https://steamcommunity\\.com/openid/id/(\\d{17})");

    /** Steam's answer has ten parameters; this is far above that and far below what a client could make us repeat. */
    private static final int MAX_PARAMETERS = 30;
    private static final int MAX_VALUE_LENGTH = 1024;

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(5);

    private static final Logger log = LoggerFactory.getLogger(SteamOpenId.class);

    private final String loginUrl;
    private final URI verifyUri;
    private final RestClient restClient;

    public SteamOpenId(AuthProperties properties) {
        this.loginUrl = properties.steam().loginUrl();
        // A setting that is not a URI fails here, at startup, and not at the first visitor's sign-in.
        URI.create(loginUrl);
        this.verifyUri = URI.create(properties.steam().verifyUrl());

        // HTTP/1.1 is forced, as for FACEIT: the JDK client otherwise tries an h2c upgrade, which WireMock does not
        // handle.
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(CONNECT_TIMEOUT)
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(READ_TIMEOUT);
        this.restClient = RestClient.builder().requestFactory(requestFactory).build();
        log.info("Sign-in with Steam: visitors are sent to {} and answers are confirmed at {}", loginUrl, verifyUri);
    }

    /**
     * The address of Steam's login page that sends the visitor back to this site's callback, with the {@code state}. The
     * origin is the one the visitor's browser used, for both the callback and the realm Steam shows the visitor.
     */
    URI loginRedirect(RequestOrigin origin, String state) {
        StringBuilder url = new StringBuilder(loginUrl).append(loginUrl.contains("?") ? '&' : '?');
        url.append(parameter("openid.ns", NAMESPACE)).append('&')
                .append(parameter("openid.mode", MODE_REQUEST)).append('&')
                .append(parameter("openid.claimed_id", IDENTIFIER_SELECT)).append('&')
                .append(parameter("openid.identity", IDENTIFIER_SELECT)).append('&')
                .append(parameter("openid.return_to", returnTo(origin, state))).append('&')
                .append(parameter("openid.realm", origin.value()));
        return URI.create(url.toString());
    }

    /**
     * Checks the answer Steam sent the visitor back with and returns the SteamID64 it vouches for.
     *
     * @param parameters the parameters of the callback request
     * @param origin the origin of the callback request
     * @param state the state of the sign-in, which the caller has already found equal to the one of the cookie
     * @throws SteamLoginRejectedException if any check fails, or Steam cannot confirm the answer
     */
    String verify(Map<String, String[]> parameters, RequestOrigin origin, String state) {
        Map<String, String> openid = openidParameters(parameters);

        if (!MODE_POSITIVE.equals(openid.get("openid.mode"))) {
            throw new SteamLoginRejectedException("the answer is not a positive one (openid.mode is not id_res)");
        }
        if (!returnTo(origin, state).equals(openid.get("openid.return_to"))) {
            throw new SteamLoginRejectedException("openid.return_to is not the callback of this site for this sign-in");
        }
        if (!loginUrl.equals(openid.get("openid.op_endpoint"))) {
            throw new SteamLoginRejectedException("openid.op_endpoint is not the login address of the setting");
        }
        Matcher claimedId = CLAIMED_ID.matcher(openid.getOrDefault("openid.claimed_id", ""));
        if (!claimedId.matches()) {
            throw new SteamLoginRejectedException("openid.claimed_id is not a Steam identity");
        }

        confirm(openid);
        return claimedId.group(1);
    }

    /** The address the visitor is sent back to: this site's callback, on the origin the visitor used, with the state. */
    private static String returnTo(RequestOrigin origin, String state) {
        return origin.value() + CALLBACK_PATH + "?state=" + state;
    }

    /** Every {@code openid.*} parameter with its one value; one that is repeated, or too much of it, is refused. */
    private static Map<String, String> openidParameters(Map<String, String[]> parameters) {
        Map<String, String> openid = new LinkedHashMap<>();
        for (Map.Entry<String, String[]> entry : parameters.entrySet()) {
            if (!entry.getKey().startsWith(PARAMETER_PREFIX)) {
                continue;
            }
            String[] values = entry.getValue();
            if (values.length != 1) {
                throw new SteamLoginRejectedException("an openid parameter was sent more than once");
            }
            if (values[0].length() > MAX_VALUE_LENGTH || openid.size() >= MAX_PARAMETERS) {
                throw new SteamLoginRejectedException("the answer has more or longer openid parameters than Steam's");
            }
            openid.put(entry.getKey(), values[0]);
        }
        return openid;
    }

    /** Has Steam say whether the answer is genuine: the parameters go back to it, and the reply must say so. */
    private void confirm(Map<String, String> openid) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        openid.forEach(form::add);
        form.set("openid.mode", MODE_VERIFY);

        String reply;
        try {
            reply = restClient.post()
                    .uri(verifyUri)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(String.class);
        } catch (RestClientException e) {
            // Only the kind of failure is named: what the exception says is Steam's or the network's to word.
            throw new SteamLoginRejectedException(
                    "Steam could not be asked to confirm the answer (" + e.getClass().getSimpleName() + ")");
        }
        if (reply == null || reply.lines().noneMatch(line -> line.strip().equals(VALID_LINE))) {
            throw new SteamLoginRejectedException("Steam did not confirm the answer (no is_valid:true)");
        }
    }

    private static String parameter(String name, String value) {
        return name + '=' + URLEncoder.encode(value, UTF_8);
    }
}
