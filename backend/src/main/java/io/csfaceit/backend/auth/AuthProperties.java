package io.csfaceit.backend.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.time.Duration;
import java.util.List;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Binds the {@code auth.*} block of {@code application.yml}: how a visitor signs in, who is an administrator and how
 * long a session lasts. The application refuses to start with an address that is not an http(s) URL, a SteamID that is
 * not 17 digits or a session that lasts no time, so a mistake shows up at startup and not at the first sign-in.
 *
 * @param steam where the browser is sent to sign in with Steam and where the backend asks whether the answer is genuine
 * @param faceit the FACEIT OAuth application; read, but not used until the sign-in with FACEIT exists (then it is on
 *        only while there is a client id)
 * @param adminSteamIds the SteamID64s of the people who get the role {@code ADMIN} when they sign in; everyone else is
 *        a {@code USER}. Blank entries are dropped, so a trailing comma in the environment variable does no harm.
 * @param sessionLifetime how long a session lasts from the moment it is made; use does not extend it
 */
@Validated
@ConfigurationProperties(prefix = "auth")
public record AuthProperties(
        @Valid @NotNull Steam steam,
        @Valid @NotNull Faceit faceit,
        List<@Pattern(regexp = "\\d{17}", message = "must be a SteamID64: 17 digits") String> adminSteamIds,
        @NotNull @DurationMin(nanos = 1) Duration sessionLifetime) {

    private static final String URL_PATTERN = "^https?://\\S+$";
    private static final String URL_MESSAGE = "must be an http or https URL";

    public AuthProperties {
        adminSteamIds = adminSteamIds == null ? List.of()
                : adminSteamIds.stream().map(String::strip).filter(id -> !id.isEmpty()).toList();
    }

    /**
     * Both addresses are Steam's own ({@code https://steamcommunity.com/openid/login}) outside the stack without a
     * FACEIT key. They are two settings because that stack has to tell them apart: the browser reaches its fake Steam
     * on a published port, while the backend reaches it by the name it has inside the Compose network.
     *
     * @param loginUrl where the browser is sent to sign in; the answer must name it as its {@code op_endpoint}
     * @param verifyUrl where the backend posts the answer back to have Steam confirm it
     */
    public record Steam(
            @NotBlank @Pattern(regexp = URL_PATTERN, message = URL_MESSAGE) String loginUrl,
            @NotBlank @Pattern(regexp = URL_PATTERN, message = URL_MESSAGE) String verifyUrl) {
    }

    /** {@code clientSecret} is never logged: {@link #toString} hides it. */
    public record Faceit(String clientId, String clientSecret) {

        /** Whether a FACEIT OAuth client id is configured, which is what will switch the sign-in with FACEIT on. */
        public boolean enabled() {
            return clientId != null && !clientId.isBlank();
        }

        /** Keeps the secret out of logs and exception messages that print the properties. */
        @Override
        public String toString() {
            return "Faceit[clientId=" + clientId + ", clientSecret=***]";
        }
    }
}
