package io.csfaceit.backend.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
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

    @AfterEach
    void clearSecurityContext() {
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

    @Test
    void theFilterNeverAnswersItselfAndAlwaysLetsTheChainDecide() throws Exception {
        MockHttpServletResponse response = runFilter(KEY, "wrong");

        assertThat(chainCalls).hasValue(1);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).isEmpty();
    }

    private MockHttpServletResponse runFilter(String configuredKey, String presentedKey) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/anything");
        if (presentedKey != null) {
            request.addHeader("X-API-Key", presentedKey);
        }
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
