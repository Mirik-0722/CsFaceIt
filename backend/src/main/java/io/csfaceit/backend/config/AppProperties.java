package io.csfaceit.backend.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Binds the {@code app.*} block of {@code application.yml}. */
@ConfigurationProperties(prefix = "app")
public record AppProperties(Security security, Cors cors) {

    /** {@code apiKey} is the secret a client sends in {@code X-API-Key} to call the protected endpoints. */
    public record Security(String apiKey) {

        /** Keeps the secret out of logs and exception messages that print the properties. */
        @Override
        public String toString() {
            return "Security[apiKey=***]";
        }
    }

    /** {@code allowedOrigins} are exact origins (scheme, host and port); {@code CORS_ALLOWED_ORIGINS} may list several. */
    public record Cors(List<String> allowedOrigins) {
    }
}
