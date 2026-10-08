package io.csfaceit.backend.faceit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.csfaceit.backend.AbstractIntegrationTest;
import io.csfaceit.backend.faceit.dto.FaceitGame;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import io.lettuce.core.ClientOptions;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * A real, unresponsive Redis must not stall callers: the cache is best effort, so its Redis calls have to fail fast.
 *
 * <p>The real Spring-wired Redis client is used (no mocked template). The shared Redis container is frozen with
 * {@code docker pause} for the duration of the call and always unpaused again; it is never stopped, because every
 * test class shares it.
 */
class CachingFaceitGatewayRedisOutageTest extends AbstractIntegrationTest {

    /** Generous against the 500 ms client timeouts (read + write = about 1 s), far below Lettuce's 60 s default. */
    private static final Duration OUTAGE_BUDGET = Duration.ofSeconds(3);

    @MockitoBean(name = "httpFaceitGateway")
    FaceitGateway delegate;

    @Autowired
    FaceitGateway gateway;

    @Autowired
    StringRedisTemplate redis;

    @Autowired
    LettuceConnectionFactory connectionFactory;

    @Test
    void unresponsiveRedisDoesNotStallTheCallerAndTheDelegateResultIsReturned() throws Exception {
        FaceitPlayer warmUp = player("p1");
        FaceitPlayer wanted = player("p2");
        when(delegate.getPlayer("p1")).thenReturn(warmUp);
        when(delegate.getPlayer("p2")).thenReturn(wanted);
        // Open the Redis connection and prove the cache works before the outage.
        gateway.getPlayer("p1");
        assertThat(redis.hasKey("faceit:player:p1")).isTrue();

        FaceitPlayer served = duringRedisOutage(() -> gateway.getPlayer("p2"));

        assertThat(served).isSameAs(wanted);
    }

    @Test
    void unresponsiveRedisAndUnavailableDelegateStillFailsFast() throws Exception {
        FaceitUnavailableException unavailable = new FaceitUnavailableException("503");
        when(delegate.getPlayer("p1")).thenReturn(player("p1"));
        when(delegate.getPlayer("p2")).thenThrow(unavailable);
        gateway.getPlayer("p1");

        // The delegate failure is the answer; the stale lookup in the dead Redis must not add a long wait.
        assertThatThrownBy(() -> duringRedisOutage(() -> gateway.getPlayer("p2"))).isSameAs(unavailable);
    }

    @Test
    void cachingResumesOnceRedisAnswersAgain() throws Exception {
        FaceitPlayer wanted = player("p3");
        when(delegate.getPlayer("p3")).thenReturn(wanted);
        duringRedisOutage(() -> gateway.getPlayer("p3"));
        // A command written just before the freeze may still have been applied once Redis thawed.
        redis.delete(List.of("faceit:player:p3", "faceit:stale:player:p3"));

        FaceitPlayer first = gateway.getPlayer("p3");
        FaceitPlayer second = gateway.getPlayer("p3");

        assertThat(first).isSameAs(wanted);
        assertThat(second).isEqualTo(wanted);
        // One call during the outage, one miss after it; the second call after recovery is a cache hit.
        verify(delegate, times(2)).getPlayer("p3");
    }

    @Test
    void redisClientIsConfiguredToFailFast() {
        assertThat(connectionFactory.getClientConfiguration().getCommandTimeout()).isEqualTo(Duration.ofMillis(500));
        ClientOptions options = connectionFactory.getClientConfiguration().getClientOptions().orElseThrow();
        assertThat(options.getSocketOptions().getConnectTimeout()).isEqualTo(Duration.ofMillis(500));
        // A dropped connection rejects commands immediately instead of buffering them until the command timeout...
        assertThat(options.getDisconnectedBehavior()).isEqualTo(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS);
        // ...and the client still reconnects on its own, so the cache comes back when Redis does.
        assertThat(options.isAutoReconnect()).isTrue();
    }

    /** Runs {@code call} while the Redis container is frozen, asserts it finishes within the budget, then thaws Redis. */
    private <T> T duringRedisOutage(Callable<T> call) throws Exception {
        String containerId = redisContainer.getContainerId();
        redisContainer.getDockerClient().pauseContainerCmd(containerId).exec();
        try {
            return assertTimeoutPreemptively(OUTAGE_BUDGET, call::call);
        } finally {
            redisContainer.getDockerClient().unpauseContainerCmd(containerId).exec();
            awaitRedisAnswering();
        }
    }

    /** Commands on one connection are answered in order, so a PING reply means the frozen backlog is processed. */
    private void awaitRedisAnswering() {
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
                assertThat(redis.execute(RedisConnection::ping)).isEqualTo("PONG"));
    }

    private static FaceitPlayer player(String id) {
        return new FaceitPlayer(id, "s1mple", null, "ua", Map.of("cs2", new FaceitGame(3500, 10)));
    }
}
