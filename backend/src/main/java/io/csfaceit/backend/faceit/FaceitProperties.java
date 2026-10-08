package io.csfaceit.backend.faceit;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Binds the {@code faceit.*} block of {@code application.yml}. */
@ConfigurationProperties(prefix = "faceit")
public record FaceitProperties(
        String baseUrl,
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
