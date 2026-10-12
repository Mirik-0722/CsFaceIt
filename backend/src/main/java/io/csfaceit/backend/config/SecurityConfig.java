package io.csfaceit.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.clip.ClipProperties;
import io.csfaceit.backend.clip.worker.WorkerTokenAuthFilter;
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
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * {@code GET} and {@code HEAD} on {@code /api/v1/**}, {@code /actuator/health} and {@code /actuator/prometheus} are
 * public; every other request needs the {@code X-API-Key} header. The one exception is the recorder's API under
 * {@code /api/worker/**}: it takes the {@code X-Worker-Token} header instead, for every method (none of it is public),
 * and the token opens nothing outside it. The key and the token travel in headers, so there are no sessions, cookies
 * or CSRF tokens, and no login form, HTTP Basic or default user either. A write endpoint added later (for example a
 * POST) is protected by this chain without further configuration, but a new {@code GET} under {@code /api/v1/**} is
 * public unless a rule is added here.
 *
 * <p>A request without a valid credential is answered 401. One that is authenticated but not allowed on its path (the
 * admin key on the worker API) is answered 403 {@code FORBIDDEN}; the worker token on {@code /api/v1/**} is no
 * credential there, so it is a 401.
 */
@Configuration(proxyBeanMethods = false)
public class SecurityConfig {

    /** Open to reads: the public API and the two actuator endpoints a monitor needs. */
    private static final String[] READ_ONLY_PATHS = {"/api/v1/**", "/actuator/health", "/actuator/prometheus"};

    /** Only the worker role reaches these, whatever the method. */
    private static final String WORKER_PATHS = WorkerTokenAuthFilter.PATH_ROOT + "/**";

    private static final String UNAUTHORIZED = "UNAUTHORIZED";
    private static final String FORBIDDEN = "FORBIDDEN";

    /** Says the same whether the key was absent or wrong. */
    private static final String UNAUTHORIZED_MESSAGE = "A valid " + ApiKeyAuthFilter.HEADER_NAME + " header is required";

    /** The same for the worker API, which does not take the key but the worker token. */
    private static final String WORKER_UNAUTHORIZED_MESSAGE =
            "A valid " + WorkerTokenAuthFilter.HEADER_NAME + " header is required";

    private static final String FORBIDDEN_MESSAGE = "The credentials presented do not allow this request";

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, AppProperties properties, ClipProperties clip,
                                            ObjectMapper mapper) throws Exception {
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .cors(Customizer.withDefaults())
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(unauthorizedEntryPoint(mapper))
                        .accessDeniedHandler(forbiddenHandler(mapper)))
                .addFilterBefore(new ApiKeyAuthFilter(properties.security().apiKey()),
                        UsernamePasswordAuthenticationFilter.class)
                // After the key's filter, so that a request with both credentials is a worker's on the worker API.
                .addFilterAfter(new WorkerTokenAuthFilter(clip.workerToken()), ApiKeyAuthFilter.class)
                .authorizeHttpRequests(requests -> {
                    // First, because the rules are tried in order: the public reads below then never include a GET of
                    // the worker API, and the last rule (any authenticated request) cannot let the admin key in.
                    requests.requestMatchers(WORKER_PATHS).hasRole(WorkerTokenAuthFilter.ROLE);
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
        cors.setAllowedMethods(List.of("GET", "POST", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Content-Type", ApiKeyAuthFilter.HEADER_NAME));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cors);
        return source;
    }

    /**
     * Answers 401 with the shared {@link ApiError} body, written directly so no error page is involved. The message
     * names the header the path takes, which is the only thing that differs between the paths.
     */
    private static AuthenticationEntryPoint unauthorizedEntryPoint(ObjectMapper mapper) {
        return (request, response, authException) -> {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            String message = WorkerTokenAuthFilter.isWorkerRequest(request)
                    ? WORKER_UNAUTHORIZED_MESSAGE : UNAUTHORIZED_MESSAGE;
            mapper.writeValue(response.getOutputStream(), new ApiError(UNAUTHORIZED, message));
        };
    }

    /**
     * Answers 403 with the shared {@link ApiError} body, in the same way. It is the answer to a request that is
     * authenticated but not allowed to do this, for instance the admin key on the worker API.
     */
    private static AccessDeniedHandler forbiddenHandler(ObjectMapper mapper) {
        return (request, response, accessDeniedException) -> {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            mapper.writeValue(response.getOutputStream(), new ApiError(FORBIDDEN, FORBIDDEN_MESSAGE));
        };
    }
}
