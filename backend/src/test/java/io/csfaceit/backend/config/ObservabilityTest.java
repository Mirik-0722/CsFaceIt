package io.csfaceit.backend.config;

import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.serviceUnavailable;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Level;
import io.csfaceit.backend.AbstractIntegrationTest;
import io.csfaceit.backend.LogCapture;
import io.csfaceit.backend.common.api.ApiExceptionHandler;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * {@code @SpringBootTest} switches metric export (and so the Prometheus registry) off; this annotation switches it
 * back on, which gives the class a Spring context of its own. Tracing is not on the classpath, so it stays off.
 */
@AutoConfigureObservability(tracing = false)
class ObservabilityTest extends AbstractIntegrationTest {

    private static final String PROMETHEUS_URL = "/actuator/prometheus";

    @Autowired
    MeterRegistry meters;

    @Test
    void prometheusExposesFaceitRequestTimer() throws Exception {
        faceit.stubFor(get(urlPathEqualTo("/players")).willReturn(okJson(fixture("faceit/player.json"))));
        mvc.perform(MockMvcRequestBuilders.get("/api/v1/players").param("nickname", "s1mple"))
                .andExpect(status().isOk());

        // The scrape needs no API key.
        String scrape = mvc.perform(MockMvcRequestBuilders.get(PROMETHEUS_URL))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(scrape).contains("faceit_request_seconds_count", "faceit_request_seconds_sum");
        assertThat(timerCount(scrape, "player_search", "success")).isGreaterThanOrEqualTo(1);
    }

    @Test
    void failedFaceitAttemptsAreCountedUnderTheErrorOutcome() throws Exception {
        long before = timerCount("player_search", "error");
        faceit.stubFor(get(urlPathEqualTo("/players")).willReturn(serviceUnavailable()));

        try (LogCapture logs = LogCapture.of(ApiExceptionHandler.class)) {
            mvc.perform(MockMvcRequestBuilders.get("/api/v1/players").param("nickname", "s1mple"))
                    .andExpect(status().isBadGateway());
            assertThat(logs.events(Level.WARN)).hasSize(1);
        }

        // Three attempts, each timed on its own.
        assertThat(timerCount("player_search", "error")).isEqualTo(before + 3);
        String scrape = mvc.perform(MockMvcRequestBuilders.get(PROMETHEUS_URL))
                .andReturn().getResponse().getContentAsString();
        assertThat(timerCount(scrape, "player_search", "error")).isEqualTo(before + 3);
    }

    @Test
    void prometheusAndHealthAnswerHeadWithoutAKey() throws Exception {
        mvc.perform(MockMvcRequestBuilders.head(PROMETHEUS_URL)).andExpect(status().isOk());
        mvc.perform(MockMvcRequestBuilders.head("/actuator/health")).andExpect(status().isOk());
    }

    @Test
    void healthIsUp() throws Exception {
        mvc.perform(MockMvcRequestBuilders.get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    private long timerCount(String resource, String outcome) {
        var timer = meters.find("faceit.request").tags("resource", resource, "outcome", outcome).timer();
        return timer == null ? 0 : timer.count();
    }

    /** The {@code faceit_request_seconds_count} sample for one resource/outcome pair, or 0 when it is absent. */
    private static long timerCount(String scrape, String resource, String outcome) {
        Pattern sample = Pattern.compile("^faceit_request_seconds_count\\{(?=[^}]*resource=\"" + resource + "\")"
                + "(?=[^}]*outcome=\"" + outcome + "\")[^}]*} (\\d+)(?:\\.0)?$", Pattern.MULTILINE);
        var matcher = sample.matcher(scrape);
        return matcher.find() ? Long.parseLong(matcher.group(1)) : 0;
    }
}
