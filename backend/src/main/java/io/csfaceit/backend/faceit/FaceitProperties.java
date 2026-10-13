package io.csfaceit.backend.faceit;

import jakarta.validation.constraints.NotBlank;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Binds the {@code faceit.*} block of {@code application.yml}. Validated, so the application refuses to start without
 * a FACEIT key instead of booting into a state where every FACEIT call fails.
 *
 * <p>{@code historyLookback} is how far back the match history reaches: FACEIT answers only the last month unless
 * the request carries a {@code from} timestamp. {@code downloads} is the access to FACEIT's Downloads API, which the
 * import of a demo needs and which is a separate token from the Data API key (see {@link Downloads}).
 */
@Validated
@ConfigurationProperties(prefix = "faceit")
public record FaceitProperties(
        String baseUrl,
        @NotBlank(message = "must not be blank: set the FACEIT_API_KEY environment variable to a FACEIT Data API key")
        String apiKey,
        Duration connectTimeout,
        Duration readTimeout,
        @DefaultValue("365d") Duration historyLookback,
        Retry retry,
        Cache cache,
        @DefaultValue Downloads downloads) {

    /** Keeps the API key out of logs and exception messages that print the properties. */
    @Override
    public String toString() {
        return "FaceitProperties[baseUrl=" + baseUrl + ", apiKey=***, connectTimeout=" + connectTimeout
                + ", readTimeout=" + readTimeout + ", historyLookback=" + historyLookback
                + ", retry=" + retry + ", cache=" + cache + ", downloads=" + downloads + "]";
    }

    /**
     * FACEIT's Downloads API, which is the only way to get a demo file: the {@code demo_url} of a match is a private cloud
     * address. {@code token} is an access token with the Downloads API scope, applied for at FACEIT (it is not the Data
     * API key); empty means no access, and the import then fetches {@code demo_url} as it is. {@code url} is the
     * endpoint, a setting so that the fake FACEIT can stand in for it. Neither value is ever logged.
     */
    public record Downloads(String token, @DefaultValue(DEFAULT_URL) String url) {

        public static final String DEFAULT_URL = "https://open.faceit.com/download/v2/demos/download";

        /** A blank address (an environment variable set to nothing) is the default one, and a token is trimmed. */
        public Downloads {
            token = token == null ? "" : token.trim();
            url = url == null || url.isBlank() ? DEFAULT_URL : url.trim();
        }

        /** Whether the site has been given access to the Downloads API. */
        public boolean configured() {
            return !token.isEmpty();
        }

        /** Keeps the token and the address out of logs and exception messages that print the properties. */
        @Override
        public String toString() {
            return "Downloads[token=" + (configured() ? "***" : "") + ", url=***]";
        }
    }

    /** {@code maxAttempts} counts all attempts, including the first one. */
    public record Retry(int maxAttempts, Duration initialBackoff, double multiplier) {
    }

    public record Cache(
            Duration playerTtl,
            Duration historyTtl,
            Duration matchTtl,
            Duration unfinishedMatchTtl,
            Duration staleTtl) {
    }
}
