package io.csfaceit.backend.faceit;

import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchHistory;
import io.csfaceit.backend.faceit.dto.FaceitMatchStats;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.function.Predicate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatusCode;
import org.springframework.retry.support.RetryTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

@Component
public class HttpFaceitGateway implements FaceitGateway {

    private static final Logger log = LoggerFactory.getLogger(HttpFaceitGateway.class);

    private static final String TIMER_NAME = "faceit.request";
    private static final String OUTCOME_SUCCESS = "success";
    private static final String OUTCOME_NOT_FOUND = "not_found";
    private static final String OUTCOME_ERROR = "error";

    private static final Predicate<HttpStatusCode> NOT_FOUND = status -> status.value() == 404;
    private static final Predicate<HttpStatusCode> API_KEY_REJECTED =
            status -> status.value() == 401 || status.value() == 403;
    private static final Predicate<HttpStatusCode> TRY_AGAIN_LATER =
            status -> status.value() == 429 || status.is5xxServerError();

    private final RestClient restClient;
    private final RetryTemplate retryTemplate;
    private final MeterRegistry meterRegistry;

    public HttpFaceitGateway(RestClient faceitRestClient, RetryTemplate faceitRetryTemplate,
                             MeterRegistry meterRegistry) {
        this.restClient = faceitRestClient;
        this.retryTemplate = faceitRetryTemplate;
        this.meterRegistry = meterRegistry;
    }

    @Override
    public FaceitPlayer findPlayerByNickname(String nickname) {
        return get("player_search", FaceitPlayer.class, "/players?nickname={nickname}", nickname);
    }

    @Override
    public FaceitPlayer getPlayer(String playerId) {
        return get("player", FaceitPlayer.class, "/players/{playerId}", playerId);
    }

    @Override
    public FaceitMatchHistory getHistory(String playerId, int offset, int limit) {
        return get("history", FaceitMatchHistory.class,
                "/players/{playerId}/history?game=cs2&offset={offset}&limit={limit}", playerId, offset, limit);
    }

    @Override
    public FaceitMatch getMatch(String matchId) {
        return get("match", FaceitMatch.class, "/matches/{matchId}", matchId);
    }

    @Override
    public FaceitMatchStats getMatchStats(String matchId) {
        return get("match_stats", FaceitMatchStats.class, "/matches/{matchId}/stats", matchId);
    }

    /**
     * Performs one GET against FACEIT: retries 429, 5xx, 401/403 and connection failures, maps statuses to the
     * gateway exceptions and times every HTTP attempt as {@code faceit.request} (so backoff sleeps are not counted
     * and each failed attempt shows up in the {@code error} count).
     *
     * @param uriTemplate relative to the configured base URL; variables are URL-encoded individually
     */
    private <T> T get(String resource, Class<T> bodyType, String uriTemplate, Object... uriVariables) {
        try {
            return retryTemplate.execute(context -> {
                Timer.Sample sample = Timer.start(meterRegistry);
                String outcome = OUTCOME_ERROR;
                try {
                    T body = restClient.get()
                            .uri(uriTemplate, uriVariables)
                            .retrieve()
                            .onStatus(NOT_FOUND, (request, response) -> {
                                throw new FaceitNotFoundException(
                                        "FACEIT has no " + resource + " at " + request.getURI());
                            })
                            .onStatus(API_KEY_REJECTED, (request, response) -> {
                                int status = response.getStatusCode().value();
                                log.error("FACEIT rejected the API key (HTTP {})", status);
                                throw new FaceitUnavailableException(
                                        "FACEIT rejected the API key (HTTP " + status + ")");
                            })
                            .onStatus(TRY_AGAIN_LATER, (request, response) -> {
                                throw new FaceitUnavailableException(
                                        "FACEIT answered HTTP " + response.getStatusCode().value()
                                                + " for " + resource);
                            })
                            .body(bodyType);
                    outcome = OUTCOME_SUCCESS;
                    return body;
                } catch (FaceitNotFoundException e) {
                    outcome = OUTCOME_NOT_FOUND;
                    throw e;
                } finally {
                    sample.stop(meterRegistry.timer(TIMER_NAME, "resource", resource, "outcome", outcome));
                }
            });
        } catch (ResourceAccessException e) {
            throw new FaceitUnavailableException("FACEIT is unreachable for " + resource, e);
        }
    }
}
