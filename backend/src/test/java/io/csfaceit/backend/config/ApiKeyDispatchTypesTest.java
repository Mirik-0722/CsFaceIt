package io.csfaceit.backend.config;

import static org.assertj.core.api.Assertions.assertThat;

import io.csfaceit.backend.AbstractIntegrationTest;
import jakarta.servlet.http.HttpServletResponse;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * A real Tomcat, because MockMvc neither re-dispatches errors to {@code /error} nor re-enters the filter chain after
 * async processing. Protected handlers that end in an ERROR or ASYNC dispatch must keep the identity the valid key
 * gave them: the authorization rules run again on those dispatches.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(ApiKeyDispatchTypesTest.ProbeController.class)
class ApiKeyDispatchTypesTest extends AbstractIntegrationTest {

    private static final String API_KEY = "test-admin-key";

    @LocalServerPort
    int port;

    private final HttpClient client = HttpClient.newHttpClient();

    @Test
    void errorDispatchOfAnAuthenticatedRequestIsNotTurnedInto401() throws Exception {
        HttpResponse<String> response = post("/api/v1/probe/send-error", API_KEY);

        assertThat(response.statusCode()).isEqualTo(409);
    }

    @Test
    void accessDeniedForAnAuthenticatedRequestIs403Not401() throws Exception {
        HttpResponse<String> response = post("/api/v1/probe/denied", API_KEY);

        assertThat(response.statusCode()).isEqualTo(403);
    }

    @Test
    void asyncHandlerOfAnAuthenticatedRequestCompletesInsteadOfAnswering401() throws Exception {
        HttpResponse<String> response = post("/api/v1/probe/async", API_KEY);

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo("async-done");
    }

    @Test
    void withoutAKeyTheSameRoutesAnswer401AndRunNoHandler() throws Exception {
        ProbeController.handlerRuns.set(0);
        for (String path : new String[] {"/api/v1/probe/send-error", "/api/v1/probe/denied", "/api/v1/probe/async"}) {
            HttpResponse<String> response = post(path, null);

            assertThat(response.statusCode()).as(path).isEqualTo(401);
            assertThat(response.body()).as(path).contains("\"code\":\"UNAUTHORIZED\"");
        }
        assertThat(ProbeController.handlerRuns.get()).isZero();
    }

    private HttpResponse<String> post(String path, String apiKey) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .POST(HttpRequest.BodyPublishers.noBody());
        if (apiKey != null) {
            request.header("X-API-Key", apiKey);
        }
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    @TestConfiguration(proxyBeanMethods = false)
    @RestController
    static class ProbeController {

        static final AtomicInteger handlerRuns = new AtomicInteger();

        @PostMapping("/api/v1/probe/send-error")
        void sendError(HttpServletResponse response) throws Exception {
            handlerRuns.incrementAndGet();
            response.sendError(HttpServletResponse.SC_CONFLICT, "conflict");
        }

        @PostMapping("/api/v1/probe/denied")
        String denied() {
            handlerRuns.incrementAndGet();
            throw new AccessDeniedException("not allowed");
        }

        @PostMapping("/api/v1/probe/async")
        Callable<String> async() {
            handlerRuns.incrementAndGet();
            return () -> "async-done";
        }
    }
}
