package io.csfaceit.backend.faceit;

import java.net.http.HttpClient;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.retry.backoff.ExponentialBackOffPolicy;
import org.springframework.retry.policy.SimpleRetryPolicy;
import org.springframework.retry.support.RetryTemplate;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

@Configuration(proxyBeanMethods = false)
public class FaceitClientConfig {

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

        SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy(retry.maxAttempts(),
                Map.of(FaceitUnavailableException.class, true, ResourceAccessException.class, true));

        RetryTemplate retryTemplate = new RetryTemplate();
        retryTemplate.setBackOffPolicy(backOffPolicy);
        retryTemplate.setRetryPolicy(retryPolicy);
        return retryTemplate;
    }
}
