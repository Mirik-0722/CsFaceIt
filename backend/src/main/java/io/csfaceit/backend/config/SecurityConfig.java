package io.csfaceit.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.common.api.ApiError;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * {@code GET} and {@code HEAD} on {@code /api/v1/**}, {@code /actuator/health} and {@code /actuator/prometheus} are
 * public; every other request needs the {@code X-API-Key} header. The key travels in a header, so there are no
 * sessions, cookies or CSRF tokens, and no login form, HTTP Basic or default user either. A write endpoint added
 * later (for example a POST) is protected by this chain without further configuration, but a new {@code GET} under
 * {@code /api/v1/**} is public unless a rule is added here.
 */
@Configuration(proxyBeanMethods = false)
public class SecurityConfig {

    /** Open to reads: the public API and the two actuator endpoints a monitor needs. */
    private static final String[] READ_ONLY_PATHS = {"/api/v1/**", "/actuator/health", "/actuator/prometheus"};

    private static final String UNAUTHORIZED = "UNAUTHORIZED";

    /** Says the same whether the key was absent or wrong. */
    private static final String UNAUTHORIZED_MESSAGE = "A valid " + ApiKeyAuthFilter.HEADER_NAME + " header is required";

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, AppProperties properties, ObjectMapper mapper)
            throws Exception {
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .cors(Customizer.withDefaults())
                .exceptionHandling(exceptions -> exceptions.authenticationEntryPoint(unauthorizedEntryPoint(mapper)))
                .addFilterBefore(new ApiKeyAuthFilter(properties.security().apiKey()),
                        UsernamePasswordAuthenticationFilter.class)
                .authorizeHttpRequests(requests -> {
                    // HEAD is a read like GET (health probes use it). CORS preflights need no rule: the CORS filter
                    // answers them before authorization, and any other OPTIONS is just another request that needs the key.
                    for (HttpMethod read : List.of(HttpMethod.GET, HttpMethod.HEAD)) {
                        requests.requestMatchers(read, READ_ONLY_PATHS).permitAll();
                    }
                    requests.anyRequest().authenticated();
                })
                .build();
    }

    /** Picked up by {@code http.cors(...)}. No credentials: the API key is a header, not a cookie. */
    @Bean
    CorsConfigurationSource corsConfigurationSource(AppProperties properties) {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(properties.cors().allowedOrigins());
        cors.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Content-Type", ApiKeyAuthFilter.HEADER_NAME));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cors);
        return source;
    }

    /** Answers 401 with the shared {@link ApiError} body, written directly so no error page is involved. */
    private static AuthenticationEntryPoint unauthorizedEntryPoint(ObjectMapper mapper) {
        return (request, response, authException) -> {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            mapper.writeValue(response.getOutputStream(), new ApiError(UNAUTHORIZED, UNAUTHORIZED_MESSAGE));
        };
    }
}
