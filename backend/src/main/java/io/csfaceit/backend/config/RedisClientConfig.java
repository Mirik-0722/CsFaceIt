package io.csfaceit.backend.config;

import io.lettuce.core.ClientOptions;
import org.springframework.boot.autoconfigure.data.redis.LettuceClientOptionsBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class RedisClientConfig {

    /**
     * While the connection is down, Lettuce by default buffers commands until it reconnects and fails them only
     * after the command timeout. Rejecting them makes a Redis outage cost the FACEIT cache nothing but an immediate,
     * logged miss. Auto-reconnect stays on, so the cache comes back by itself when Redis does. A Redis that stays
     * connected but stops answering is bounded by {@code spring.data.redis.timeout}.
     */
    @Bean
    LettuceClientOptionsBuilderCustomizer rejectCommandsWhileDisconnected() {
        return builder -> builder.disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS);
    }
}
