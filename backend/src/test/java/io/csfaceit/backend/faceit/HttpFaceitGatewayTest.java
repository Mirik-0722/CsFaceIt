package io.csfaceit.backend.faceit;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.moreThanOrExactly;
import static com.github.tomakehurst.wiremock.client.WireMock.notFound;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.serviceUnavailable;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.github.tomakehurst.wiremock.client.ResponseDefinitionBuilder;
import com.github.tomakehurst.wiremock.http.Fault;
import com.github.tomakehurst.wiremock.stubbing.Scenario;
import io.csfaceit.backend.AbstractIntegrationTest;
import io.csfaceit.backend.faceit.dto.FaceitGame;
import io.csfaceit.backend.faceit.dto.FaceitHistoryItem;
import io.csfaceit.backend.faceit.dto.FaceitHistoryPlayer;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchHistory;
import io.csfaceit.backend.faceit.dto.FaceitMatchStats;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import io.csfaceit.backend.faceit.dto.FaceitStatsPlayer;
import io.csfaceit.backend.faceit.dto.FaceitStatsRound;
import io.csfaceit.backend.faceit.dto.FaceitStatsTeam;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.web.client.ResourceAccessException;

@ExtendWith(OutputCaptureExtension.class)
class HttpFaceitGatewayTest extends AbstractIntegrationTest {

    private static final String PLAYER_ID = "11111111-1111-1111-1111-111111111111";
    private static final String MATCH_ID = "1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    private static final String PLAYER_PATH = "/players/" + PLAYER_ID;
    private static final String HISTORY_PATH = PLAYER_PATH + "/history";
    private static final String MATCH_PATH = "/matches/" + MATCH_ID;
    private static final String STATS_PATH = MATCH_PATH + "/stats";

    @Autowired
    HttpFaceitGateway gateway;

    @Autowired
    MeterRegistry meterRegistry;

    @Test
    void findsPlayerByNicknameWithBearerHeader() {
        faceit.stubFor(get(urlPathEqualTo("/players")).withQueryParam("nickname", equalTo("s1mple"))
                .withHeader("Authorization", equalTo("Bearer test-key"))
                .willReturn(okJson(fixture("faceit/player.json"))));

        FaceitPlayer player = gateway.findPlayerByNickname("s1mple");

        assertThat(player.playerId()).isEqualTo(PLAYER_ID);
        assertThat(player.nickname()).isEqualTo("s1mple");
        assertThat(player.avatar()).isEqualTo("https://assets.example/avatars/s1mple.jpg");
        assertThat(player.country()).isEqualTo("ua");
        assertThat(player.cs2()).get()
                .extracting(FaceitGame::faceitElo, FaceitGame::skillLevel)
                .containsExactly(3500, 10);
    }

    @Test
    void getsPlayerById() {
        faceit.stubFor(get(urlPathEqualTo(PLAYER_PATH))
                .withHeader("Authorization", equalTo("Bearer test-key"))
                .willReturn(okJson(fixture("faceit/player.json"))));

        FaceitPlayer player = gateway.getPlayer(PLAYER_ID);

        assertThat(player.playerId()).isEqualTo(PLAYER_ID);
        assertThat(player.cs2()).get().extracting(FaceitGame::faceitElo).isEqualTo(3500);
    }

    @Test
    void playerWithoutCs2HasEmptyCs2() {
        faceit.stubFor(get(urlPathEqualTo(PLAYER_PATH)).willReturn(okJson(fixture("faceit/player-no-cs2.json"))));

        FaceitPlayer player = gateway.getPlayer(PLAYER_ID);

        assertThat(player.playerId()).isEqualTo(PLAYER_ID);
        assertThat(player.games()).containsOnlyKeys("csgo");
        assertThat(player.cs2()).isEmpty();
    }

    @Test
    void encodesNicknameAsASingleQueryParameter() {
        String nickname = "we ird&nick=1/é";
        faceit.stubFor(get(urlPathEqualTo("/players")).withQueryParam("nickname", equalTo(nickname))
                .willReturn(okJson(fixture("faceit/player.json"))));

        gateway.findPlayerByNickname(nickname);

        faceit.verify(1, getRequestedFor(urlPathEqualTo("/players")).withQueryParam("nickname", equalTo(nickname)));
    }

    @Test
    void notFoundMapsToFaceitNotFoundExceptionWithoutRetry() {
        faceit.stubFor(get(urlPathEqualTo("/players")).withQueryParam("nickname", equalTo("ghost"))
                .willReturn(notFound()));

        assertThatThrownBy(() -> gateway.findPlayerByNickname("ghost"))
                .isInstanceOf(FaceitNotFoundException.class);

        faceit.verify(1, getRequestedFor(urlPathEqualTo("/players")));
    }

    @ParameterizedTest
    @ValueSource(ints = {401, 403})
    void rejectedApiKeyMapsToFaceitUnavailable(int status, CapturedOutput output) {
        faceit.stubFor(get(urlPathEqualTo(PLAYER_PATH)).willReturn(aResponse().withStatus(status)));

        assertThatThrownBy(() -> gateway.getPlayer(PLAYER_ID))
                .isInstanceOf(FaceitUnavailableException.class);

        assertThat(output).contains("ERROR").contains("FACEIT rejected the API key");
    }

    @Test
    void emptyResponseBodyMapsToFaceitUnavailable() {
        faceit.stubFor(get(urlPathEqualTo(PLAYER_PATH)).willReturn(aResponse().withStatus(200)));

        assertThatThrownBy(() -> gateway.getPlayer(PLAYER_ID))
                .isInstanceOf(FaceitUnavailableException.class)
                .hasMessageContaining("empty body")
                .hasMessageContaining("player");

        // An empty 200 is an upstream fault like a 5xx, so it is retried the same way.
        faceit.verify(3, getRequestedFor(urlPathEqualTo(PLAYER_PATH)));
    }

    @Test
    void retriesOn5xxThenSucceeds() {
        stubScenarioStep(Scenario.STARTED, "after-503", serviceUnavailable());
        stubScenarioStep("after-503", "after-429", aResponse().withStatus(429));
        stubScenarioStep("after-429", "done", okJson(fixture("faceit/player.json")));

        Instant start = Instant.now();
        FaceitPlayer player = gateway.getPlayer(PLAYER_ID);
        Duration elapsed = Duration.between(start, Instant.now());

        assertThat(player.playerId()).isEqualTo(PLAYER_ID);
        faceit.verify(3, getRequestedFor(urlPathEqualTo(PLAYER_PATH)));
        // Exponential backoff from the configured 200 ms: 200 ms + 400 ms between the three attempts.
        assertThat(elapsed).isGreaterThanOrEqualTo(Duration.ofMillis(550));
    }

    @Test
    void givesUpAfterThreeAttempts() {
        faceit.stubFor(get(urlPathEqualTo(PLAYER_PATH)).willReturn(serviceUnavailable()));

        assertThatThrownBy(() -> gateway.getPlayer(PLAYER_ID))
                .isInstanceOf(FaceitUnavailableException.class);

        faceit.verify(3, getRequestedFor(urlPathEqualTo(PLAYER_PATH)));
    }

    @Test
    void connectionFailureIsRetriedThenMapsToFaceitUnavailable() {
        faceit.stubFor(get(urlPathEqualTo(PLAYER_PATH))
                .willReturn(aResponse().withFault(Fault.CONNECTION_RESET_BY_PEER)));

        Instant start = Instant.now();
        assertThatThrownBy(() -> gateway.getPlayer(PLAYER_ID))
                .isInstanceOf(FaceitUnavailableException.class)
                .hasCauseInstanceOf(ResourceAccessException.class);
        Duration elapsed = Duration.between(start, Instant.now());

        // The JDK HttpClient silently re-sends an idempotent GET once after a connection reset, so WireMock sees
        // between 3 and 6 requests. The backoff sleeps (200 ms + 400 ms) only happen between our own attempts.
        faceit.verify(moreThanOrExactly(3), getRequestedFor(urlPathEqualTo(PLAYER_PATH)));
        assertThat(elapsed).isGreaterThanOrEqualTo(Duration.ofMillis(550));
    }

    @Test
    void historyPassesGameOffsetLimit() {
        faceit.stubFor(get(urlPathEqualTo(HISTORY_PATH))
                .withQueryParam("game", equalTo("cs2"))
                .withQueryParam("offset", equalTo("20"))
                .withQueryParam("limit", equalTo("10"))
                .willReturn(okJson(fixture("faceit/history.json"))));

        FaceitMatchHistory history = gateway.getHistory(PLAYER_ID, 20, 10);

        faceit.verify(1, getRequestedFor(urlPathEqualTo(HISTORY_PATH))
                .withQueryParam("game", equalTo("cs2"))
                .withQueryParam("offset", equalTo("20"))
                .withQueryParam("limit", equalTo("10")));
        assertThat(history.start()).isZero();
        assertThat(history.end()).isEqualTo(2);
        assertThat(history.items()).hasSize(2);

        FaceitHistoryItem won = history.items().get(0);
        assertThat(won.matchId()).isEqualTo(MATCH_ID);
        assertThat(won.startedAt()).isEqualTo(1700000000L);
        assertThat(won.finishedAt()).isEqualTo(1700002400L);
        assertThat(won.teams().get("faction1").players())
                .extracting(FaceitHistoryPlayer::playerId)
                .contains(PLAYER_ID);
        assertThat(won.results().winner()).isEqualTo("faction1");
        assertThat(won.results().score()).containsEntry("faction1", 13).containsEntry("faction2", 9);

        FaceitHistoryItem lost = history.items().get(1);
        assertThat(lost.teams().get("faction2").players())
                .extracting(FaceitHistoryPlayer::playerId)
                .contains(PLAYER_ID);
        assertThat(lost.results().winner()).isEqualTo("faction1");
    }

    @Test
    void parsesFinishedMatch() {
        faceit.stubFor(get(urlPathEqualTo(MATCH_PATH)).willReturn(okJson(fixture("faceit/match-finished.json"))));

        FaceitMatch match = gateway.getMatch(MATCH_ID);

        assertThat(match.matchId()).isEqualTo(MATCH_ID);
        assertThat(match.status()).isEqualTo("FINISHED");
        assertThat(match.startedAt()).isEqualTo(1700000000L);
        assertThat(match.finishedAt()).isEqualTo(1700002400L);
        assertThat(match.voting().map().pick()).containsExactly("de_mirage");
        assertThat(match.demoUrl()).containsExactly("https://demos.example/1.dem.gz");
        assertThat(match.results().winner()).isEqualTo("faction1");
        assertThat(match.results().score()).containsEntry("faction1", 13).containsEntry("faction2", 9);
        assertThat(match.teams().get("faction1").name()).isEqualTo("team_A");
        assertThat(match.teams().get("faction2").name()).isEqualTo("team_B");
        assertThat(match.teams().get("faction1").roster()).hasSize(5)
                .anySatisfy(player -> {
                    assertThat(player.playerId()).isEqualTo(PLAYER_ID);
                    assertThat(player.nickname()).isEqualTo("s1mple");
                });
        assertThat(match.teams().get("faction2").roster()).hasSize(5);
    }

    @Test
    void parsesOngoingMatchWithoutResults() {
        faceit.stubFor(get(urlPathEqualTo(MATCH_PATH)).willReturn(okJson(fixture("faceit/match-ongoing.json"))));

        FaceitMatch match = gateway.getMatch(MATCH_ID);

        assertThat(match.status()).isEqualTo("ONGOING");
        assertThat(match.startedAt()).isEqualTo(1700000000L);
        assertThat(match.finishedAt()).isNull();
        assertThat(match.results()).isNull();
        assertThat(match.demoUrl()).isNull();
        assertThat(match.teams()).containsOnlyKeys("faction1", "faction2");
    }

    @Test
    void parsesMatchStats() {
        faceit.stubFor(get(urlPathEqualTo(STATS_PATH)).willReturn(okJson(fixture("faceit/match-stats.json"))));

        FaceitMatchStats stats = gateway.getMatchStats(MATCH_ID);

        assertThat(stats.rounds()).hasSize(1);
        FaceitStatsRound round = stats.rounds().get(0);
        assertThat(round.roundStats())
                .containsEntry("Map", "de_mirage")
                .containsEntry("Rounds", "22")
                .containsEntry("Score", "13 / 9");
        assertThat(round.teams()).hasSize(2);

        FaceitStatsTeam teamA = round.teams().get(0);
        assertThat(teamA.teamStats())
                .containsEntry("Team", "team_A")
                .containsEntry("Team Win", "1")
                .containsEntry("Final Score", "13");
        assertThat(teamA.players()).hasSize(5);
        FaceitStatsPlayer s1mple = teamA.players().get(0);
        assertThat(s1mple.playerId()).isEqualTo(PLAYER_ID);
        assertThat(s1mple.nickname()).isEqualTo("s1mple");
        assertThat(s1mple.playerStats())
                .containsEntry("Kills", "25")
                .containsEntry("Deaths", "14")
                .containsEntry("Assists", "3")
                .containsEntry("Headshots", "12")
                .containsEntry("K/D Ratio", "1.79")
                .containsEntry("K/R Ratio", "1.14")
                .containsEntry("ADR", "95.4");

        FaceitStatsTeam teamB = round.teams().get(1);
        assertThat(teamB.teamStats())
                .containsEntry("Team", "team_B")
                .containsEntry("Team Win", "0")
                .containsEntry("Final Score", "9");
        assertThat(teamB.players()).hasSize(5);
    }

    @Test
    void recordsRequestTimerWithResourceAndOutcomeTags() {
        faceit.stubFor(get(urlPathEqualTo("/players")).willReturn(okJson(fixture("faceit/player.json"))));
        faceit.stubFor(get(urlPathEqualTo(PLAYER_PATH)).willReturn(okJson(fixture("faceit/player.json"))));
        faceit.stubFor(get(urlPathEqualTo(HISTORY_PATH)).willReturn(serviceUnavailable()));
        faceit.stubFor(get(urlPathEqualTo(MATCH_PATH)).willReturn(okJson(fixture("faceit/match-finished.json"))));
        faceit.stubFor(get(urlPathEqualTo(STATS_PATH)).willReturn(notFound()));
        long searchSuccess = timerCount("player_search", "success");
        long playerSuccess = timerCount("player", "success");
        long historyError = timerCount("history", "error");
        long matchSuccess = timerCount("match", "success");
        long statsNotFound = timerCount("match_stats", "not_found");

        gateway.findPlayerByNickname("s1mple");
        gateway.getPlayer(PLAYER_ID);
        assertThatThrownBy(() -> gateway.getHistory(PLAYER_ID, 0, 20)).isInstanceOf(FaceitUnavailableException.class);
        gateway.getMatch(MATCH_ID);
        assertThatThrownBy(() -> gateway.getMatchStats(MATCH_ID)).isInstanceOf(FaceitNotFoundException.class);

        assertThat(timerCount("player_search", "success")).isEqualTo(searchSuccess + 1);
        assertThat(timerCount("player", "success")).isEqualTo(playerSuccess + 1);
        // The timer measures every HTTP attempt, so one call that exhausts its three attempts records three errors.
        assertThat(timerCount("history", "error")).isEqualTo(historyError + 3);
        assertThat(timerCount("match", "success")).isEqualTo(matchSuccess + 1);
        assertThat(timerCount("match_stats", "not_found")).isEqualTo(statsNotFound + 1);
        assertThat(meterRegistry.get("faceit.request").tags("resource", "match", "outcome", "success").timer()
                .totalTime(TimeUnit.NANOSECONDS)).isPositive();
    }

    private void stubScenarioStep(String requiredState, String nextState,
                                  ResponseDefinitionBuilder response) {
        faceit.stubFor(get(urlPathEqualTo(PLAYER_PATH))
                .inScenario("retry")
                .whenScenarioStateIs(requiredState)
                .willReturn(response)
                .willSetStateTo(nextState));
    }

    private long timerCount(String resource, String outcome) {
        Timer timer = meterRegistry.find("faceit.request").tags("resource", resource, "outcome", outcome).timer();
        return timer == null ? 0 : timer.count();
    }
}
