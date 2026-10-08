package io.csfaceit.backend.common.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Level;
import io.csfaceit.backend.LogCapture;
import io.csfaceit.backend.faceit.FaceitNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Handler behaviour that the player endpoints cannot reach, driven through a standalone MockMvc and a probe
 * controller: no Spring context and no containers.
 */
class ApiExceptionHandlerTest {

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();
        mvc = MockMvcBuilders.standaloneSetup(new ProbeController())
                .setControllerAdvice(new ApiExceptionHandler())
                .setValidator(validator)
                .build();
    }

    @Test
    void notFoundExceptionKeepsItsCodeAndMessage() throws Exception {
        mvc.perform(get("/probe/not-found"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MATCH_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("Match not found: m-1"));
    }

    @Test
    void faceitNotFoundThatEscapesTheServiceBecomes404WithoutLeakingTheFaceitUrl() throws Exception {
        try (LogCapture logs = LogCapture.of(ApiExceptionHandler.class)) {
            mvc.perform(get("/probe/faceit-not-found"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("NOT_FOUND"))
                    .andExpect(content().string(not(containsString("open.faceit.com"))));

            assertThat(logs.events(Level.WARN)).hasSize(1);
        }
    }

    @Test
    void unexpectedExceptionBecomes500WithoutLeakingDetailsAndIsLoggedWithStackTrace() throws Exception {
        try (LogCapture logs = LogCapture.of(ApiExceptionHandler.class)) {
            mvc.perform(get("/probe/boom"))
                    .andExpect(status().isInternalServerError())
                    .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                    .andExpect(jsonPath("$.message").value("Unexpected server error"))
                    .andExpect(content().string(not(containsString("secret table"))))
                    .andExpect(content().string(not(containsString("IllegalStateException"))))
                    .andExpect(content().string(not(containsString("ProbeController"))));

            assertThat(logs.events(Level.ERROR)).singleElement().satisfies(event -> {
                assertThat(event.getThrowableProxy().getClassName()).isEqualTo("java.lang.IllegalStateException");
                assertThat(event.getThrowableProxy().getMessage()).isEqualTo("secret table detail");
            });
        }
    }

    @Test
    void invalidRequestBodyBecomes400ValidationError() throws Exception {
        mvc.perform(post("/probe/body").contentType(MediaType.APPLICATION_JSON).content("{\"name\": \"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.message").value(containsString("name")));
    }

    @Test
    void invalidMethodParameterBecomes400ValidationError() throws Exception {
        mvc.perform(get("/probe/param").param("tag", "toolong"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.message").value(containsString("tag")));
    }

    @Test
    void unreadableRequestBodyBecomes400ValidationError() throws Exception {
        mvc.perform(post("/probe/body").contentType(MediaType.APPLICATION_JSON).content("{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void unsupportedMediaTypeKeepsItsStatus() throws Exception {
        mvc.perform(post("/probe/body").contentType(MediaType.TEXT_PLAIN).content("x"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_MEDIA_TYPE"));
    }

    record Body(@NotBlank String name) {
    }

    @RestController
    static class ProbeController {

        @GetMapping("/probe/not-found")
        String notFound() {
            throw new NotFoundException("MATCH_NOT_FOUND", "Match not found: m-1");
        }

        @GetMapping("/probe/faceit-not-found")
        String faceitNotFound() {
            throw new FaceitNotFoundException("FACEIT has no match at https://open.faceit.com/data/v4/matches/m-1");
        }

        @GetMapping("/probe/boom")
        String boom() {
            throw new IllegalStateException("secret table detail");
        }

        @PostMapping("/probe/body")
        String body(@Valid @RequestBody Body body) {
            return body.name();
        }

        @GetMapping("/probe/param")
        String param(@RequestParam @Size(max = 3) String tag) {
            return tag;
        }
    }
}
