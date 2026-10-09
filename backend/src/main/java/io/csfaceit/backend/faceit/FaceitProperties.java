package io.csfaceit.backend.faceit;

import jakarta.validation.constraints.NotBlank;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Binds the {@code faceit.*} block of {@code application.yml}. Validated, so the application refuses to start without
 * a FACEIT key instead of booting into a state where every FACEIT call fails.
 */
@Validated
@ConfigurationProperties(prefix = "faceit")
public record FaceitProperties(
        String baseUrl,
        @NotBlank(message = "must not be blank: set the FACEIT_API_KEY environment variable to a FACEIT Data API key")
        String apiKey,
        Duration connectTimeout,
        Duration readTimeout,
        Retry retry,
        Cache cache) {

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
