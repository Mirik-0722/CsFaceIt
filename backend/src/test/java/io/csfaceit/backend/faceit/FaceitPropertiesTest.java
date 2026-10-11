package io.csfaceit.backend.faceit;

import static org.assertj.core.api.Assertions.assertThat;

import io.csfaceit.backend.LogCapture;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Configuration;

/**
 * Startup validation of the {@code faceit.*} block. A {@code .env} copied from {@code .env.example} leaves
 * {@code FACEIT_API_KEY} empty, and an app that boots with it would fail every FACEIT call, so it must not start.
 */
class FaceitPropertiesTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(PropertiesConfig.class)
            .withPropertyValues("faceit.base-url=https://open.faceit.com/data/v4");

    @Test
    void aNonBlankApiKeyBinds() {
        runner.withPropertyValues("faceit.api-key=live-key").run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(FaceitProperties.class).apiKey()).isEqualTo("live-key");
        });
    }

    @Test
    void anEmptyApiKeyFailsStartup() {
        assertStartupFailsWithoutAKey(runner.withPropertyValues("faceit.api-key="));
    }

    @Test
    void aWhitespaceOnlyApiKeyFailsStartup() {
        assertStartupFailsWithoutAKey(runner.withPropertyValues("faceit.api-key=   "));
    }

    @Test
    void anUnsetApiKeyFailsStartup() {
        assertStartupFailsWithoutAKey(runner);
    }

    /** The failure must say what to do about it, since it is the only thing the operator sees in the container log. */
    private static void assertStartupFailsWithoutAKey(ApplicationContextRunner runner) {
        // The context logs its failed refresh at WARN; the runner rethrows the cause, so the log adds nothing here.
        try (LogCapture ignored = LogCapture.of(AnnotationConfigApplicationContext.class)) {
            runner.run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure())
                        .hasStackTraceContaining("faceit.apiKey")
                        .hasStackTraceContaining("must not be blank")
                        .hasStackTraceContaining("FACEIT_API_KEY");
            });
        }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(FaceitProperties.class)
    static class PropertiesConfig {
    }
}
