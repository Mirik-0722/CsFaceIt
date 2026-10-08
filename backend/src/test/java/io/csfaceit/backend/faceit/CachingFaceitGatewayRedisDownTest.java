package io.csfaceit.backend.faceit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.csfaceit.backend.AbstractIntegrationTest;
import io.csfaceit.backend.faceit.dto.FaceitGame;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** Redis outages must never reach the caller. Mocking the template forces a Spring context of its own. */
@ExtendWith(OutputCaptureExtension.class)
class CachingFaceitGatewayRedisDownTest extends AbstractIntegrationTest {

    private static final FaceitPlayer PLAYER =
            new FaceitPlayer("p1", "s1mple", null, "ua", Map.of("cs2", new FaceitGame(3500, 10)));

    @MockitoBean
    StringRedisTemplate redis;

    @MockitoBean(name = "httpFaceitGateway")
    FaceitGateway delegate;

    @Autowired
    FaceitGateway gateway;

    @Test
    void readFailureFallsThroughToDelegate(CapturedOutput output) {
        when(redis.opsForValue()).thenThrow(new RedisConnectionFailureException("down"));
        when(delegate.getPlayer("p1")).thenReturn(PLAYER);

        assertThat(gateway.getPlayer("p1")).isSameAs(PLAYER);

        verify(delegate).getPlayer("p1");
        assertThat(output).contains("WARN").contains("Redis read of faceit:player:p1 failed");
    }

    @Test
    @SuppressWarnings("unchecked")
    void writeFailureStillReturnsDelegateResult(CapturedOutput output) {
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenReturn(null);
        doThrow(new RedisConnectionFailureException("down"))
                .when(values).set(anyString(), anyString(), any(Duration.class));
        when(delegate.getPlayer("p1")).thenReturn(PLAYER);

        assertThat(gateway.getPlayer("p1")).isSameAs(PLAYER);

        verify(values, atLeastOnce()).set(eq("faceit:player:p1"), anyString(), eq(Duration.ofMinutes(5)));
        assertThat(output).contains("WARN").contains("Redis write of faceit:player:p1 failed")
                .doesNotContain("Redis read of");
    }

    @Test
    void redisDownDoesNotMaskDelegateFailure() {
        FaceitUnavailableException unavailable = new FaceitUnavailableException("503");
        when(redis.opsForValue()).thenThrow(new RedisConnectionFailureException("down"));
        when(delegate.getPlayer("p1")).thenThrow(unavailable);

        assertThatThrownBy(() -> gateway.getPlayer("p1")).isSameAs(unavailable);
    }
}
