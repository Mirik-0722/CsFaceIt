package io.csfaceit.backend;

import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.options;

import com.github.tomakehurst.wiremock.WireMockServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Base class for every integration test.
 *
 * <p>The PostgreSQL container, the Redis container and the FACEIT WireMock server are singletons
 * started once per JVM in the static block. The {@code @Testcontainers}/{@code @Container} lifecycle
 * and {@code WireMockExtension} are deliberately not used: they restart the infrastructure for every
 * test class, which leaves the cached Spring context pointing at stale ports.
 */
@SpringBootTest
@AutoConfigureMockMvc
public abstract class AbstractIntegrationTest {

    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17");

    static final GenericContainer<?> redis = new GenericContainer<>("redis:8").withExposedPorts(6379);

    protected static final WireMockServer faceit = new WireMockServer(options().dynamicPort());

    static {
        postgres.start();
        redis.start();
        faceit.start();
    }

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
        registry.add("faceit.base-url", faceit::baseUrl);
        registry.add("faceit.api-key", () -> "test-key");
        registry.add("app.security.api-key", () -> "test-admin-key");
    }

    @Autowired
    protected MockMvc mvc;

    @Autowired
    private JdbcTemplate jdbc;

    // Used instead of a RedisTemplate: later tests mock StringRedisTemplate, and the reset must still reach Redis.
    @Autowired
    private RedisConnectionFactory redisConnectionFactory;

    @BeforeEach
    protected void resetState() {
        faceit.resetAll();
        jdbc.execute("TRUNCATE player_match_stats, highlights, matches, players RESTART IDENTITY CASCADE");
        try (RedisConnection connection = redisConnectionFactory.getConnection()) {
            connection.serverCommands().flushAll();
        }
    }

    protected static String fixture(String classpathPath) {
        try {
            return new String(new ClassPathResource(classpathPath).getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read fixture " + classpathPath, e);
        }
    }
}
