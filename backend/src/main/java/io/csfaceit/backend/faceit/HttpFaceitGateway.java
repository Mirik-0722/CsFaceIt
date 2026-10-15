package io.csfaceit.backend.faceit;

import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchHistory;
import io.csfaceit.backend.faceit.dto.FaceitMatchStats;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import io.csfaceit.backend.faceit.dto.FaceitPlayerMatchStats;
import io.csfaceit.backend.faceit.dto.FaceitPlayerStatsPage;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Clock;
import java.time.Duration;
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
    private static final Predicate<HttpStatusCode> TRY_AGAIN_LATER =
            status -> status.value() == 429 || status.is5xxServerError();
    /** Evaluated after the two predicates above, so this is every 4xx except 404 and 429. */
    private static final Predicate<HttpStatusCode> REQUEST_REJECTED = HttpStatusCode::is4xxClientError;

    private static final String REJECTED_HINT = "FACEIT rejected the request (check FACEIT_API_KEY)";

    private final RestClient restClient;
    private final RetryTemplate retryTemplate;
    private final MeterRegistry meterRegistry;
    private final Clock clock;
    private final Duration historyLookback;

    public HttpFaceitGateway(RestClient faceitRestClient, RetryTemplate faceitRetryTemplate,
                             MeterRegistry meterRegistry, Clock clock, FaceitProperties properties) {
        this.restClient = faceitRestClient;
        this.retryTemplate = faceitRetryTemplate;
        this.meterRegistry = meterRegistry;
        this.clock = clock;
        this.historyLookback = properties.historyLookback();
    }

    @Override
    public FaceitPlayer findPlayerByNickname(String nickname) {
        return get("player_search", FaceitPlayer.class, "/players?nickname={nickname}", nickname);
    }

    @Override
    public FaceitPlayer findPlayerBySteamId(String steamId) {
        return get("player_by_steam_id", FaceitPlayer.class, "/players?game=cs2&game_player_id={steamId}", steamId);
    }

    @Override
    public FaceitPlayer getPlayer(String playerId) {
        return get("player", FaceitPlayer.class, "/players/{playerId}", playerId);
    }

    @Override
    public FaceitMatchHistory getHistory(String playerId, int offset, int limit) {
        // Without "from" FACEIT only returns the last month, so a player inactive for 30 days would have no matches.
        long from = clock.instant().minus(historyLookback).getEpochSecond();
        return get("history", FaceitMatchHistory.class,
                "/players/{playerId}/history?game=cs2&offset={offset}&limit={limit}&from={from}",
                playerId, offset, limit, from);
    }

    @Override
    public FaceitPlayerMatchStats getPlayerMatchStats(String playerId, int offset, int limit) {
        // The same lower bound as the history's, so that both lists reach equally far back. FACEIT documents it as Unix
        // time like the history's; were it read as milliseconds it would only reach further back, which is harmless.
        long from = clock.instant().minus(historyLookback).getEpochSecond();
        return get("player_match_stats", FaceitPlayerStatsPage.class,
                "/players/{playerId}/games/cs2/stats?offset={offset}&limit={limit}&from={from}",
                playerId, offset, limit, from).matchStats();
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
     * Performs one GET against FACEIT: retries 429, 5xx, empty response bodies and connection failures, maps statuses
     * to the gateway exceptions (404 to {@link FaceitNotFoundException}; any other 4xx to the non-retried
     * {@link FaceitRejectedException}) and times every HTTP attempt as {@code faceit.request} (so backoff sleeps
     * are not counted and each failed attempt shows up in the {@code error} count).
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
                            .onStatus(TRY_AGAIN_LATER, (request, response) -> {
                                throw new FaceitUnavailableException(
                                        "FACEIT answered HTTP " + response.getStatusCode().value()
                                                + " for " + resource);
                            })
                            .onStatus(REQUEST_REJECTED, (request, response) -> {
                                int status = response.getStatusCode().value();
                                // FACEIT answers a bad or revoked key with 400 invalid_token as well as 401/403.
                                boolean keyIsSuspect = status == 400 || status == 401 || status == 403;
                                log.error("FACEIT answered HTTP {} for {}{}", status, resource,
                                        keyIsSuspect ? ": " + REJECTED_HINT : "");
                                throw new FaceitRejectedException(
                                        "FACEIT rejected the request for " + resource + " (HTTP " + status + ")", status);
                            })
                            .body(bodyType);
                    if (body == null) {
                        // A 200 (or 204) without a body is an upstream fault, not a missing resource.
                        throw new FaceitUnavailableException("FACEIT returned an empty body for " + resource);
                    }
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
