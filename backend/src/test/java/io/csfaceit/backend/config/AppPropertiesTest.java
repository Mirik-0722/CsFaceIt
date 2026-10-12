package io.csfaceit.backend.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.cors.CorsConfiguration;

/** Binding of the {@code app.*} block, exactly as {@code application.yml} and the environment variables feed it. */
class AppPropertiesTest {

    @Test
    void bindsTheApiKeyAndASingleOrigin() {
        AppProperties properties = bind(Map.of(
                "app.security.api-key", "s3cret",
                "app.cors.allowed-origins", "http://localhost:5173"));

        assertThat(properties.security().apiKey()).isEqualTo("s3cret");
        assertThat(properties.cors().allowedOrigins()).containsExactly("http://localhost:5173");
    }

    @Test
    void theApiKeyDoesNotShowInToString() {
        AppProperties properties = bind(Map.of(
                "app.security.api-key", "s3cret",
                "app.cors.allowed-origins", "http://localhost:5173"));

        assertThat(properties.toString()).doesNotContain("s3cret");
        assertThat(properties.security().toString()).doesNotContain("s3cret");
    }

    @Test
    void commaSeparatedOriginsBindToATrimmedList() {
        AppProperties properties = bind(Map.of(
                "app.security.api-key", "s3cret",
                "app.cors.allowed-origins", "http://localhost:5173, https://app.example ,https://admin.example"));

        assertThat(properties.cors().allowedOrigins())
                .containsExactly("http://localhost:5173", "https://app.example", "https://admin.example");
    }

    @Test
    void everyConfiguredOriginIsAllowedAndNoOtherOneIs() {
        AppProperties properties = bind(Map.of(
                "app.security.api-key", "s3cret",
                "app.cors.allowed-origins", "http://localhost:5173,https://app.example"));

        CorsConfiguration cors = new SecurityConfig().corsConfigurationSource(properties)
                .getCorsConfiguration(new MockHttpServletRequest("GET", "/api/v1/players"));

        assertThat(cors).isNotNull();
        assertThat(cors.checkOrigin("http://localhost:5173")).isEqualTo("http://localhost:5173");
        assertThat(cors.checkOrigin("https://app.example")).isEqualTo("https://app.example");
        assertThat(cors.checkOrigin("https://evil.example")).isNull();
        // Sub-domains, other ports and other schemes of an allowed origin are different origins.
        assertThat(cors.checkOrigin("https://sub.app.example")).isNull();
        assertThat(cors.checkOrigin("http://localhost:5174")).isNull();
        assertThat(cors.checkOrigin("http://app.example")).isNull();
        assertThat(cors.getAllowedOrigins()).doesNotContain("*");
        assertThat(cors.getAllowedOriginPatterns()).isNull();
        assertThat(cors.getAllowCredentials()).isNotEqualTo(Boolean.TRUE);
        assertThat(cors.getAllowedMethods()).containsExactly("GET", "POST", "DELETE", "OPTIONS");
        assertThat(cors.getAllowedHeaders()).containsExactly("Content-Type", "X-API-Key");
    }

    @Test
    void noConfiguredOriginAllowsNoOrigin() {
        AppProperties properties = new AppProperties(new AppProperties.Security("s3cret"),
                new AppProperties.Cors(List.of()));

        CorsConfiguration cors = new SecurityConfig().corsConfigurationSource(properties)
                .getCorsConfiguration(new MockHttpServletRequest("GET", "/api/v1/players"));

        assertThat(cors.checkOrigin("http://localhost:5173")).isNull();
    }

    private static AppProperties bind(Map<String, String> properties) {
        return new Binder(new MapConfigurationPropertySource(properties)).bind("app", AppProperties.class).get();
    }
}
