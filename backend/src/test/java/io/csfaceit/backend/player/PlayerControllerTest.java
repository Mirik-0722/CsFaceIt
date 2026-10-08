package io.csfaceit.backend.player;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.anyUrl;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.notFound;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.serviceUnavailable;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.nullValue;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Level;
import io.csfaceit.backend.AbstractIntegrationTest;
import io.csfaceit.backend.LogCapture;
import io.csfaceit.backend.common.api.ApiExceptionHandler;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class PlayerControllerTest extends AbstractIntegrationTest {

    private static final String PLAYER_ID = "11111111-1111-1111-1111-111111111111";
    private static final String PLAYERS_URL = "/api/v1/players";
    private static final String FACEIT_PLAYER_PATH = "/players/" + PLAYER_ID;
    private static final String FACEIT_HISTORY_PATH = FACEIT_PLAYER_PATH + "/history";

    @Autowired
    PlayerRepository players;

    /** Keeps the handler's expected WARN/ERROR lines (and stack traces) off the console; tests may assert on them. */
    private LogCapture logs;

    @BeforeEach
    void captureHandlerLogs() {
        logs = LogCapture.of(ApiExceptionHandler.class);
    }

    @AfterEach
    void releaseHandlerLogs() {
        logs.close();
    }

    @Test
    void searchByNicknameReturnsProfileAndPersistsPlayer() throws Exception {
        stubPlayerSearch("s1mple", "faceit/player.json");

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL).param("nickname", "s1mple"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.playerId").value(PLAYER_ID))
                .andExpect(jsonPath("$.nickname").value("s1mple"))
                .andExpect(jsonPath("$.avatar").value("https://assets.example/avatars/s1mple.jpg"))
                .andExpect(jsonPath("$.country").value("ua"))
                .andExpect(jsonPath("$.elo").value(3500))
                .andExpect(jsonPath("$.level").value(10));

        assertThat(players.findByFaceitId(PLAYER_ID)).get()
                .extracting(Player::getNickname, Player::getElo, Player::getLevel)
                .containsExactly("s1mple", 3500, 10);
    }

    @Test
    void searchForPlayerWithoutCs2ReturnsNullEloAndLevel() throws Exception {
        stubPlayerSearch("s1mple", "faceit/player-no-cs2.json");

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL).param("nickname", "s1mple"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.playerId").value(PLAYER_ID))
                .andExpect(jsonPath("$.elo").value(nullValue()))
                .andExpect(jsonPath("$.level").value(nullValue()));

        assertThat(players.findByFaceitId(PLAYER_ID)).get()
                .extracting(Player::getElo, Player::getLevel)
                .containsExactly(null, null);
    }

    @Test
    void unknownNicknameReturns404PlayerNotFound() throws Exception {
        faceit.stubFor(get(urlPathEqualTo("/players")).withQueryParam("nickname", equalTo("ghost"))
                .willReturn(notFound()));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL).param("nickname", "ghost"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PLAYER_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("Player not found: ghost"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"a", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "<script>", "bad nick", "nick:name", ""})
    void invalidNicknameReturns400(String nickname) throws Exception {
        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL).param("nickname", nickname))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.message").value(startsWith("nickname must be 2-32 characters")));

        faceit.verify(0, anyRequestedFor(anyUrl()));
    }

    @Test
    void nicknameOfThirtyTwoCharactersIsAccepted() throws Exception {
        String nickname = "x".repeat(32);
        stubPlayerSearch(nickname, "faceit/player.json");

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL).param("nickname", nickname))
                .andExpect(status().isOk());
    }

    @Test
    void missingNicknameReturns400() throws Exception {
        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.message").value("Required parameter 'nickname' is missing"));
    }

    @Test
    void unknownRouteReturns404NotFound() throws Exception {
        mvc.perform(MockMvcRequestBuilders.get("/api/v1/nope"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void wrongMethodReturns405MethodNotAllowed() throws Exception {
        // Spring logs every handled MVC exception at WARN; capture it to keep the console clean.
        try (LogCapture springLogs = LogCapture.of("org.springframework.web.servlet.PageNotFound")) {
            mvc.perform(post(PLAYERS_URL).param("nickname", "s1mple"))
                    .andExpect(status().isMethodNotAllowed())
                    .andExpect(jsonPath("$.code").value("METHOD_NOT_ALLOWED"));

            assertThat(springLogs.events()).hasSize(1);
        }
    }

    @Test
    void getByIdReturnsProfileAndRefreshesPlayerRow() throws Exception {
        players.save(new Player(PLAYER_ID, "oldNick", 1000, 3));
        faceit.stubFor(get(urlPathEqualTo(FACEIT_PLAYER_PATH)).willReturn(okJson(fixture("faceit/player.json"))));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.playerId").value(PLAYER_ID))
                .andExpect(jsonPath("$.nickname").value("s1mple"))
                .andExpect(jsonPath("$.elo").value(3500))
                .andExpect(jsonPath("$.level").value(10));

        assertThat(players.count()).isEqualTo(1);
        assertThat(players.findByFaceitId(PLAYER_ID)).get()
                .extracting(Player::getNickname, Player::getElo, Player::getLevel)
                .containsExactly("s1mple", 3500, 10);
    }

    @Test
    void getByIdPersistsPlayerNotSeenBefore() throws Exception {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_PLAYER_PATH)).willReturn(okJson(fixture("faceit/player.json"))));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID))
                .andExpect(status().isOk());

        assertThat(players.findByFaceitId(PLAYER_ID)).isPresent();
    }

    @Test
    void getByUnknownIdReturns404PlayerNotFound() throws Exception {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_PLAYER_PATH)).willReturn(notFound()));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PLAYER_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("Player not found: " + PLAYER_ID));
    }

    @ParameterizedTest
    @ValueSource(strings = {"bad:id", "bad.id", "bad id", "bad_id", "bad*id",
            "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"})
    void playerIdWithIllegalCharactersOrLengthReturns400(String playerId) throws Exception {
        for (String suffix : new String[] {"", "/history"}) {
            mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + playerId + suffix))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.message").value(startsWith("playerId must be 1-64 characters")));
        }

        faceit.verify(0, anyRequestedFor(anyUrl()));
    }

    @Test
    void playerIdOfSixtyFourCharactersIsAccepted() throws Exception {
        String playerId = "a".repeat(64);
        faceit.stubFor(get(urlPathEqualTo("/players/" + playerId)).willReturn(okJson(fixture("faceit/player.json"))));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + playerId))
                .andExpect(status().isOk());
    }

    @Test
    void historyMapsWinLossForPlayer() throws Exception {
        stubHistory(fixture("faceit/history.json"));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID + "/history"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.offset").value(0))
                .andExpect(jsonPath("$.limit").value(20))
                .andExpect(jsonPath("$.items.length()").value(2))
                // s1mple is in faction1 and faction1 won.
                .andExpect(jsonPath("$.items[0].matchId").value("1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"))
                .andExpect(jsonPath("$.items[0].result").value("WIN"))
                .andExpect(jsonPath("$.items[0].score.faction1").value(13))
                .andExpect(jsonPath("$.items[0].score.faction2").value(9))
                .andExpect(jsonPath("$.items[0].startedAt").value("2023-11-14T22:13:20Z"))
                .andExpect(jsonPath("$.items[0].finishedAt").value("2023-11-14T22:53:20Z"))
                // s1mple is in faction2 and faction1 won.
                .andExpect(jsonPath("$.items[1].matchId").value("1-bbbbbbbb-cccc-dddd-eeee-ffffffffffff"))
                .andExpect(jsonPath("$.items[1].result").value("LOSS"))
                .andExpect(jsonPath("$.items[1].score.faction1").value(16))
                .andExpect(jsonPath("$.items[1].score.faction2").value(14));
    }

    @Test
    void historyForwardsOffsetAndLimitAndEchoesThem() throws Exception {
        stubHistory(fixture("faceit/history.json"));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID + "/history").param("offset", "40").param("limit", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.offset").value(40))
                .andExpect(jsonPath("$.limit").value(100));

        faceit.verify(1, getRequestedFor(urlPathEqualTo(FACEIT_HISTORY_PATH))
                .withQueryParam("game", equalTo("cs2"))
                .withQueryParam("offset", equalTo("40"))
                .withQueryParam("limit", equalTo("100")));
    }

    @Test
    void historyResultIsUnknownWhenPlayerIsOnNeitherTeam() throws Exception {
        stubHistory(historyJson("faction1", "22222222-2222-2222-2222-222222222222",
                "66666666-6666-6666-6666-666666666666"));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID + "/history"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].result").value("UNKNOWN"));
    }

    @Test
    void historyResultIsUnknownWhenMatchHasNoWinner() throws Exception {
        stubHistory(historyJson(null, PLAYER_ID, "66666666-6666-6666-6666-666666666666"));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID + "/history"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].result").value("UNKNOWN"));
    }

    @Test
    void historyOfPlayerWithoutMatchesIsEmpty() throws Exception {
        stubHistory("{\"items\": [], \"start\": 0, \"end\": 0}");

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID + "/history"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    @ParameterizedTest
    @ValueSource(strings = {"limit=101", "limit=0", "limit=-5", "offset=-1", "limit=abc", "offset=1.5"})
    void historyRejectsInvalidLimitAndOffset(String query) throws Exception {
        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID + "/history?" + query))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.message").value(containsString(query.substring(0, query.indexOf('=')))));

        faceit.verify(0, anyRequestedFor(anyUrl()));
    }

    @Test
    void historyForUnknownPlayerReturns404PlayerNotFound() throws Exception {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_HISTORY_PATH)).willReturn(notFound()));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID + "/history"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PLAYER_NOT_FOUND"));
    }

    @Test
    void faceitOutageReturns502() throws Exception {
        faceit.stubFor(get(urlPathEqualTo("/players")).willReturn(serviceUnavailable()));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL).param("nickname", "s1mple"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("FACEIT_UNAVAILABLE"));

        faceit.verify(3, getRequestedFor(urlPathEqualTo("/players")));
        assertThat(logs.events(Level.WARN)).singleElement()
                .satisfies(event -> assertThat(event.getFormattedMessage()).startsWith("FACEIT is unavailable"));
        assertThat(players.count()).isZero();
    }

    @Test
    void faceitOutageOnHistoryReturns502() throws Exception {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_HISTORY_PATH)).willReturn(serviceUnavailable()));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID + "/history"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("FACEIT_UNAVAILABLE"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"application/json", "text/html"})
    void unparseableFaceitBodyReturns502(String contentType) throws Exception {
        faceit.stubFor(get(urlPathEqualTo("/players")).willReturn(aResponse()
                .withStatus(200).withHeader("Content-Type", contentType).withBody("<html>this is not json</html>")));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL).param("nickname", "s1mple"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("FACEIT_UNAVAILABLE"))
                .andExpect(jsonPath("$.message").value("FACEIT is unavailable"));

        assertThat(logs.events(Level.ERROR)).singleElement().satisfies(event -> {
            assertThat(event.getFormattedMessage()).isEqualTo("FACEIT returned an unusable response");
            assertThat(event.getThrowableProxy()).isNotNull();
        });
        assertThat(players.count()).isZero();
    }

    @Test
    void emptyFaceitBodyReturns502() throws Exception {
        faceit.stubFor(get(urlPathEqualTo("/players")).willReturn(aResponse().withStatus(200)));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL).param("nickname", "s1mple"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("FACEIT_UNAVAILABLE"));
    }

    @Test
    void unexpectedFaceitClientErrorReturns502() throws Exception {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_PLAYER_PATH)).willReturn(aResponse().withStatus(400)));

        mvc.perform(MockMvcRequestBuilders.get(PLAYERS_URL + "/" + PLAYER_ID))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("FACEIT_UNAVAILABLE"));

        assertThat(logs.events(Level.ERROR)).hasSize(1);
    }

    private static void stubPlayerSearch(String nickname, String fixturePath) {
        faceit.stubFor(get(urlPathEqualTo("/players")).withQueryParam("nickname", equalTo(nickname))
                .willReturn(okJson(fixture(fixturePath))));
    }

    private static void stubHistory(String body) {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_HISTORY_PATH)).willReturn(okJson(body)));
    }

    /** A one-match history with {@code faction1Player} and {@code faction2Player} as the only players. */
    private static String historyJson(String winner, String faction1Player, String faction2Player) {
        String results = winner == null
                ? "{\"score\": {\"faction1\": 0, \"faction2\": 0}}"
                : "{\"winner\": \"" + winner + "\", \"score\": {\"faction1\": 13, \"faction2\": 9}}";
        return """
                {"items": [{
                  "match_id": "1-cccccccc-dddd-eeee-ffff-000000000000",
                  "started_at": 1700000000,
                  "finished_at": 1700002400,
                  "teams": {
                    "faction1": {"team_id": "t1", "nickname": "team_A", "players": [{"player_id": "%s", "nickname": "a"}]},
                    "faction2": {"team_id": "t2", "nickname": "team_B", "players": [{"player_id": "%s", "nickname": "b"}]}
                  },
                  "results": %s
                }], "start": 0, "end": 1}
                """.formatted(faction1Player, faction2Player, results);
    }
}
