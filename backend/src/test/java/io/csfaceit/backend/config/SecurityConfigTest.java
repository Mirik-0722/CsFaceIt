package io.csfaceit.backend.config;

import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.anyUrl;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.csfaceit.backend.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/** The API-key filter chain and the CORS policy, through the real filter chain (the key is {@code test-admin-key}). */
class SecurityConfigTest extends AbstractIntegrationTest {

    private static final String API_KEY_HEADER = "X-API-Key";
    private static final String API_KEY = "test-admin-key";
    private static final String UNKNOWN_URL = "/api/v1/anything";
    private static final String PLAYERS_URL = "/api/v1/players";
    private static final String FRONTEND_ORIGIN = "http://localhost:5173";
    private static final String FOREIGN_ORIGIN = "http://evil.example";

    @Autowired
    ApplicationContext context;

    @Test
    void getEndpointsAreOpen() throws Exception {
        faceit.stubFor(get(urlPathEqualTo("/players")).withQueryParam("nickname", equalTo("s1mple"))
                .willReturn(okJson(fixture("faceit/player.json"))));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL).param("nickname", "s1mple"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nickname").value("s1mple"));
    }

    @Test
    void headOnAReadRouteIsOpenLikeGet() throws Exception {
        faceit.stubFor(get(urlPathEqualTo("/players")).withQueryParam("nickname", equalTo("s1mple"))
                .willReturn(okJson(fixture("faceit/player.json"))));

        mvc.perform(head(PLAYERS_URL).param("nickname", "s1mple"))
                .andExpect(status().isOk());
    }

    @Test
    void headOnHealthIsOpen() throws Exception {
        mvc.perform(head("/actuator/health"))
                .andExpect(status().isOk());
    }

    @Test
    void headOnAnythingElseStillNeedsTheApiKey() throws Exception {
        mvc.perform(head("/something-else"))
                .andExpect(status().isUnauthorized());
        mvc.perform(head("/actuator/metrics"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void postWithoutApiKeyIs401() throws Exception {
        mvc.perform(post(UNKNOWN_URL))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("Content-Type", MediaType.APPLICATION_JSON_VALUE))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.message").value("A valid X-API-Key header is required"));
    }

    @Test
    void postWithWrongApiKeyIs401() throws Exception {
        mvc.perform(post(UNKNOWN_URL).header(API_KEY_HEADER, "wrong"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("Content-Type", MediaType.APPLICATION_JSON_VALUE))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    /**
     * Every way of presenting a bad key gets the very same answer, so the response cannot be used to tell an absent
     * key from a wrong one, nor a near miss from a distant one.
     */
    @ParameterizedTest
    @ValueSource(strings = {"", " ", "wrong", "test-admin-ke", "test-admin-keyx", "TEST-ADMIN-KEY", "test-admin-key "})
    void badApiKeyGetsTheSame401AsNoKeyAtAll(String presentedKey) throws Exception {
        String withoutKey = mvc.perform(post(UNKNOWN_URL))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getContentAsString();

        mvc.perform(post(UNKNOWN_URL).header(API_KEY_HEADER, presentedKey))
                .andExpect(status().isUnauthorized())
                .andExpect(content().string(withoutKey));
    }

    @Test
    void emptyApiKeyHeaderIs401() throws Exception {
        mvc.perform(post(UNKNOWN_URL).header(API_KEY_HEADER, ""))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"POST", "PUT", "PATCH", "DELETE"})
    void everyNonReadMethodNeedsTheApiKey(String method) throws Exception {
        mvc.perform(request(HttpMethod.valueOf(method), UNKNOWN_URL))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    /** CORS preflights are answered by the CORS filter before authorization; a plain OPTIONS is just another request. */
    @Test
    void optionsThatIsNotACorsPreflightNeedsTheApiKey() throws Exception {
        mvc.perform(options(UNKNOWN_URL))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mvc.perform(options(PLAYERS_URL))
                .andExpect(status().isUnauthorized());
        // An Origin header alone does not make it a preflight either: it lacks Access-Control-Request-Method.
        mvc.perform(options(PLAYERS_URL).header("Origin", FRONTEND_ORIGIN))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void optionsThatIsNotACorsPreflightPassesTheFilterWithTheApiKey() throws Exception {
        mvc.perform(options(PLAYERS_URL).header(API_KEY_HEADER, API_KEY))
                .andExpect(status().isOk())
                .andExpect(header().exists("Allow"));
    }

    @Test
    void unknownPathOutsideApiNeedsTheApiKeyToo() throws Exception {
        mvc.perform(MockMvcRequestBuilders.get("/something-else"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void postWithApiKeyPassesTheFilter() throws Exception {
        // No controller handles this path: getting past the filter means the dispatcher answers, not the 401 entry point.
        mvc.perform(post(UNKNOWN_URL).header(API_KEY_HEADER, API_KEY))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void unauthorizedResponsesCarryNoAuthenticationChallenge() throws Exception {
        mvc.perform(post(UNKNOWN_URL))
                .andExpect(status().isUnauthorized())
                .andExpect(header().doesNotExist("WWW-Authenticate"));
        // HTTP Basic is not enabled either: credentials in an Authorization header change nothing.
        mvc.perform(post(UNKNOWN_URL).header("Authorization", "Basic dXNlcjpwYXNzd29yZA=="))
                .andExpect(status().isUnauthorized())
                .andExpect(header().doesNotExist("WWW-Authenticate"));
    }

    @Test
    void authenticatedRequestsSetNoSessionOrCookie() throws Exception {
        MvcResult result = mvc.perform(post(UNKNOWN_URL).header(API_KEY_HEADER, API_KEY))
                .andExpect(header().doesNotExist("Set-Cookie"))
                .andReturn();

        assertThat(result.getRequest().getSession(false)).isNull();
    }

    @Test
    void thereIsNoGeneratedDefaultUser() {
        assertThat(context.getBeanNamesForType(UserDetailsService.class)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/actuator/metrics", "/actuator/info"})
    void actuatorEndpointsOtherThanHealthAndPrometheusNeedTheApiKey(String path) throws Exception {
        mvc.perform(MockMvcRequestBuilders.get(path))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mvc.perform(MockMvcRequestBuilders.get(path).header(API_KEY_HEADER, "wrong"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void actuatorMetricsIsServedWithTheApiKey() throws Exception {
        mvc.perform(MockMvcRequestBuilders.get("/actuator/metrics").header(API_KEY_HEADER, API_KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.names").isArray());
    }

    @Test
    void corsAllowsTheConfiguredOrigin() throws Exception {
        preflight(FRONTEND_ORIGIN, "GET", null)
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", FRONTEND_ORIGIN))
                .andExpect(header().string("Access-Control-Allow-Methods", "GET,POST,OPTIONS"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
    }

    @Test
    void corsPreflightOfAProtectedMethodNeedsNoApiKeyAndAllowsTheKeyHeader() throws Exception {
        preflight(FRONTEND_ORIGIN, "POST", "Content-Type, X-API-Key")
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", FRONTEND_ORIGIN))
                .andExpect(header().string("Access-Control-Allow-Headers", "Content-Type, X-API-Key"));
    }

    @Test
    void corsRejectsAnyOtherOrigin() throws Exception {
        preflight(FOREIGN_ORIGIN, "GET", null)
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void corsAnswersAForeignOriginsActualRequestWith403WithoutCallingTheApi() throws Exception {
        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL).param("nickname", "s1mple").header("Origin", FOREIGN_ORIGIN))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));

        faceit.verify(0, anyRequestedFor(anyUrl()));
    }

    @Test
    void corsAddsTheOriginHeaderToAnAllowedOriginsActualRequest() throws Exception {
        faceit.stubFor(get(urlPathEqualTo("/players")).willReturn(okJson(fixture("faceit/player.json"))));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL).param("nickname", "s1mple").header("Origin", FRONTEND_ORIGIN))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", FRONTEND_ORIGIN))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"))
                .andExpect(content().string(not(containsString("UNAUTHORIZED"))));
    }

    @ParameterizedTest
    @ValueSource(strings = {"DELETE", "PUT", "PATCH"})
    void corsRejectsMethodsOtherThanGetPostOptions(String method) throws Exception {
        preflight(FRONTEND_ORIGIN, method, null)
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void corsRejectsHeadersOtherThanContentTypeAndApiKey() throws Exception {
        preflight(FRONTEND_ORIGIN, "POST", "Authorization")
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    private ResultActions preflight(String origin, String method, String requestHeaders) throws Exception {
        var preflight = options(PLAYERS_URL)
                .header("Origin", origin)
                .header("Access-Control-Request-Method", method);
        if (requestHeaders != null) {
            preflight.header("Access-Control-Request-Headers", requestHeaders);
        }
        return mvc.perform(preflight);
    }
}
