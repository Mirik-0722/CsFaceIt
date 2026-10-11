package io.csfaceit.backend.config;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import io.csfaceit.backend.LogCapture;
import jakarta.servlet.DispatcherType;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

/** The filter in isolation: what it makes of the {@code X-API-Key} header, whatever the configured key is. */
class ApiKeyAuthFilterTest {

    private static final String KEY = "test-admin-key";

    private final AtomicReference<Authentication> seenByChain = new AtomicReference<>();
    private final AtomicInteger chainCalls = new AtomicInteger();

    /** The filter warns about an unusable key when it is built; captured so the console stays clean. */
    private LogCapture logs;

    @BeforeEach
    void captureFilterLogs() {
        logs = LogCapture.of(ApiKeyAuthFilter.class);
    }

    @AfterEach
    void releaseFilterLogsAndClearSecurityContext() {
        logs.close();
        SecurityContextHolder.clearContext();
    }

    @Test
    void matchingKeyAuthenticatesAnAdmin() throws Exception {
        runFilter(KEY, KEY);

        assertThat(seenByChain.get()).isNotNull();
        assertThat(seenByChain.get().isAuthenticated()).isTrue();
        assertThat(seenByChain.get().getName()).isEqualTo("api-key");
        assertThat(seenByChain.get().getAuthorities()).extracting(GrantedAuthority::getAuthority)
                .containsExactly("ROLE_ADMIN");
        assertThat(chainCalls).hasValue(1);
    }

    @Test
    void keyWithNonAsciiCharactersMatchesItself() throws Exception {
        runFilter("päss-ключ-密码", "päss-ключ-密码");

        assertThat(seenByChain.get()).isNotNull();
    }

    @Test
    void missingHeaderDoesNotAuthenticate() throws Exception {
        runFilter(KEY, null);

        assertThat(seenByChain.get()).isNull();
        assertThat(chainCalls).hasValue(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " ", "wrong", "test-admin-ke", "test-admin-keyx", "TEST-ADMIN-KEY", " test-admin-key"})
    void anyOtherHeaderValueDoesNotAuthenticate(String presented) throws Exception {
        runFilter(KEY, presented);

        assertThat(seenByChain.get()).isNull();
        assertThat(chainCalls).hasValue(1);
    }

    /** A key that was never configured must not turn "no key presented" into a match. */
    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", " ", "   "})
    void blankConfiguredKeyAuthenticatesNobody(String configuredKey) throws Exception {
        for (String presented : new String[] {null, "", " ", "   ", "anything", "null"}) {
            seenByChain.set(null);

            runFilter(configuredKey, presented);

            assertThat(seenByChain.get()).as("configured %s, presented %s", configuredKey, presented).isNull();
        }
        // Even presenting the blank key itself gets nowhere.
        runFilter(configuredKey, configuredKey);
        assertThat(seenByChain.get()).isNull();
    }

    /**
     * The container re-dispatches a request to {@code /error} (after {@code sendError}) and back into the servlet
     * after async processing. The security chain, and with it the authorization rules, run again on those dispatches,
     * and the identity is held only for the dispatch it was set on, so the key must be read again: the header is
     * still on the re-dispatched request.
     */
    @Test
    void validKeyAuthenticatesTheErrorDispatchToo() throws Exception {
        runFilter(KEY, KEY, request -> {
            request.setDispatcherType(DispatcherType.ERROR);
            request.setAttribute("jakarta.servlet.error.request_uri", "/api/v1/anything");
            request.setAttribute("jakarta.servlet.error.status_code", 403);
        });

        assertThat(seenByChain.get()).isNotNull();
        assertThat(seenByChain.get().isAuthenticated()).isTrue();
        assertThat(chainCalls).hasValue(1);
    }

    @Test
    void validKeyAuthenticatesTheAsyncDispatchToo() throws Exception {
        runFilter(KEY, KEY, request -> request.setDispatcherType(DispatcherType.ASYNC));

        assertThat(seenByChain.get()).isNotNull();
        assertThat(seenByChain.get().isAuthenticated()).isTrue();
        assertThat(chainCalls).hasValue(1);
    }

    @Test
    void errorAndAsyncDispatchesWithoutAMatchingKeyStayAnonymous() throws Exception {
        runFilter(KEY, "wrong", request -> {
            request.setDispatcherType(DispatcherType.ERROR);
            request.setAttribute("jakarta.servlet.error.request_uri", "/api/v1/anything");
        });
        assertThat(seenByChain.get()).isNull();

        runFilter(KEY, null, request -> request.setDispatcherType(DispatcherType.ASYNC));
        assertThat(seenByChain.get()).isNull();
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", " ", "   ", "\t"})
    void blankConfiguredKeyIsWarnedAboutOnceWithoutAnyKeyMaterial(String configuredKey) {
        new ApiKeyAuthFilter(configuredKey);

        assertThat(logs.events()).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.WARN);
            assertThat(event.getFormattedMessage())
                    .contains("admin API key is unusable", "reject every request", "blank");
        });
    }

    @ParameterizedTest
    @ValueSource(strings = {" padded-secret", "padded-secret ", "\tpadded-secret\n"})
    void keyWithSurroundingWhitespaceIsWarnedAboutAndNeverLogged(String configuredKey) {
        new ApiKeyAuthFilter(configuredKey);

        assertThat(logs.events()).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.WARN);
            assertThat(event.getFormattedMessage())
                    .contains("admin API key is unusable", "reject every request", "whitespace")
                    .doesNotContain("padded-secret");
        });
    }

    /** Containers trim header values, so such a key could never match; it must not match in any environment. */
    @ParameterizedTest
    @ValueSource(strings = {" padded-secret", "padded-secret "})
    void keyWithSurroundingWhitespaceAuthenticatesNobodyEvenWhenPresentedVerbatim(String configuredKey)
            throws Exception {
        runFilter(configuredKey, configuredKey);
        assertThat(seenByChain.get()).isNull();

        runFilter(configuredKey, configuredKey.strip());
        assertThat(seenByChain.get()).isNull();
    }

    @Test
    void usableKeyIsNotWarnedAbout() {
        new ApiKeyAuthFilter(KEY);
        new ApiKeyAuthFilter("päss-ключ-密码");

        assertThat(logs.events()).isEmpty();
    }

    @Test
    void theFilterNeverAnswersItselfAndAlwaysLetsTheChainDecide() throws Exception {
        MockHttpServletResponse response = runFilter(KEY, "wrong");

        assertThat(chainCalls).hasValue(1);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).isEmpty();
    }

    private MockHttpServletResponse runFilter(String configuredKey, String presentedKey) throws Exception {
        return runFilter(configuredKey, presentedKey, request -> { });
    }

    private MockHttpServletResponse runFilter(String configuredKey, String presentedKey,
            Consumer<MockHttpServletRequest> customizer) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/anything");
        if (presentedKey != null) {
            request.addHeader("X-API-Key", presentedKey);
        }
        customizer.accept(request);
        MockHttpServletResponse response = new MockHttpServletResponse();
        chainCalls.set(0);
        seenByChain.set(null);

        new ApiKeyAuthFilter(configuredKey).doFilter(request, response, (req, res) -> {
            chainCalls.incrementAndGet();
            seenByChain.set(SecurityContextHolder.getContext().getAuthentication());
        });
        return response;
    }
}
