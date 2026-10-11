package io.csfaceit.backend.faceit;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpClient;
import java.time.Clock;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.retry.backoff.ExponentialBackOffPolicy;
import org.springframework.retry.policy.SimpleRetryPolicy;
import org.springframework.retry.support.RetryTemplate;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

@Configuration(proxyBeanMethods = false)
public class FaceitClientConfig {

    /** The time source for "now" in FACEIT requests; a bean so that tests can pin it. */
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    RestClient faceitRestClient(FaceitProperties properties) {
        // HTTP/1.1 is forced: the JDK client otherwise tries an h2c upgrade, which WireMock does not handle.
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.connectTimeout())
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(properties.readTimeout());
        return RestClient.builder()
                .baseUrl(properties.baseUrl())
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + properties.apiKey())
                .requestFactory(requestFactory)
                .build();
    }

    @Bean
    RetryTemplate faceitRetryTemplate(FaceitProperties properties) {
        FaceitProperties.Retry retry = properties.retry();

        ExponentialBackOffPolicy backOffPolicy = new ExponentialBackOffPolicy();
        backOffPolicy.setInitialInterval(retry.initialBackoff().toMillis());
        backOffPolicy.setMultiplier(retry.multiplier());

        // The most specific class wins: a rejected request (FACEIT answered 4xx) fails the same way every time.
        SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy(retry.maxAttempts(),
                Map.of(FaceitUnavailableException.class, true, FaceitRejectedException.class, false,
                        ResourceAccessException.class, true));

        RetryTemplate retryTemplate = new RetryTemplate();
        retryTemplate.setBackOffPolicy(backOffPolicy);
        retryTemplate.setRetryPolicy(retryPolicy);
        return retryTemplate;
    }

    /**
     * The gateway every service receives: the Redis cache wrapped around the HTTP gateway. The delegate is looked
     * up by bean name and interface type, so tests can replace the {@code httpFaceitGateway} bean with a mock.
     */
    @Bean
    @Primary
    FaceitGateway cachingFaceitGateway(@Qualifier("httpFaceitGateway") FaceitGateway delegate,
                                       StringRedisTemplate redis, ObjectMapper mapper, FaceitProperties properties) {
        return new CachingFaceitGateway(delegate, redis, mapper, properties);
    }
}
