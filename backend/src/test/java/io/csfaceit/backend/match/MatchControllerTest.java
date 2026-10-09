package io.csfaceit.backend.match;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.anyUrl;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.notFound;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.serviceUnavailable;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.endsWith;
import static org.hamcrest.Matchers.nullValue;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.csfaceit.backend.AbstractIntegrationTest;
import io.csfaceit.backend.LogCapture;
import io.csfaceit.backend.common.api.ApiExceptionHandler;
import io.csfaceit.backend.player.Player;
import io.csfaceit.backend.player.PlayerRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class MatchControllerTest extends AbstractIntegrationTest {

    private static final String MATCH_ID = "1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    private static final String S1MPLE_ID = "11111111-1111-1111-1111-111111111111";
    private static final String MATCHES_URL = "/api/v1/matches";
    private static final String FACEIT_MATCH_PATH = "/matches/" + MATCH_ID;
    private static final String FACEIT_STATS_PATH = FACEIT_MATCH_PATH + "/stats";

    private static final List<String> ROSTER_IDS = List.of(
            "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222",
            "33333333-3333-3333-3333-333333333333", "44444444-4444-4444-4444-444444444444",
            "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666",
            "77777777-7777-7777-7777-777777777777", "88888888-8888-8888-8888-888888888888",
            "99999999-9999-9999-9999-999999999999", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    @Autowired
    MatchRepository matches;

    @Autowired
    PlayerRepository players;

    @Autowired
    PlayerMatchStatsRepository playerMatchStats;

    @Autowired
    JdbcTemplate jdbc;

    /** Keeps the handler's expected WARN/ERROR lines (and stack traces) off the console. */
    private LogCapture logs;

    @BeforeEach
    void captureHandlerLogs() {
        logs = LogCapture.of(ApiExceptionHandler.class);
    }

    @AfterEach
    void releaseHandlerLogs() {
        logs.close();
    }

    // ---- GET /api/v1/matches/{matchId} ----

    @Test
    void getMatchReturnsDetailsAndPersistsMatch() throws Exception {
        stubMatch("faceit/match-finished.json");

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matchId").value(MATCH_ID))
                .andExpect(jsonPath("$.mapName").value("de_mirage"))
                .andExpect(jsonPath("$.status").value("FINISHED"))
                .andExpect(jsonPath("$.startedAt").value("2023-11-14T22:13:20Z"))
                .andExpect(jsonPath("$.finishedAt").value("2023-11-14T22:53:20Z"))
                .andExpect(jsonPath("$.demoUrl").value(endsWith(".dem.gz")))
                .andExpect(jsonPath("$.winner").value("faction1"))
                .andExpect(jsonPath("$.teams.length()").value(2))
                .andExpect(jsonPath("$.teams[0].factionId").value("faction1"))
                .andExpect(jsonPath("$.teams[0].name").value("team_A"))
                .andExpect(jsonPath("$.teams[0].players.length()").value(5))
                .andExpect(jsonPath("$.teams[0].players[0].playerId").value(S1MPLE_ID))
                .andExpect(jsonPath("$.teams[0].players[0].nickname").value("s1mple"))
                .andExpect(jsonPath("$.teams[1].factionId").value("faction2"))
                .andExpect(jsonPath("$.teams[1].name").value("team_B"))
                .andExpect(jsonPath("$.teams[1].players.length()").value(5))
                .andExpect(jsonPath("$.teams[1].players[0].nickname").value("playerB1"));

        assertThat(matches.count()).isEqualTo(1);
        assertThat(matches.findByFaceitMatchId(MATCH_ID)).get()
                .extracting(Match::getMapName, Match::getStartedAt, Match::getFinishedAt)
                .containsExactly("de_mirage", Instant.ofEpochSecond(1700000000L), Instant.ofEpochSecond(1700002400L));
        // Only the match is stored; the roster players are created when the stats are requested.
        assertThat(players.count()).isZero();
    }

    @Test
    void getMatchUpdatesTheStoredRowInsteadOfAddingAnother() throws Exception {
        matches.save(new Match(MATCH_ID, "de_old", Instant.ofEpochSecond(1L), null));
        stubMatch("faceit/match-finished.json");

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID))
                .andExpect(status().isOk());

        assertThat(matches.count()).isEqualTo(1);
        assertThat(matches.findByFaceitMatchId(MATCH_ID)).get()
                .extracting(Match::getMapName, Match::getStartedAt, Match::getFinishedAt)
                .containsExactly("de_mirage", Instant.ofEpochSecond(1700000000L), Instant.ofEpochSecond(1700002400L));
    }

    @Test
    void ongoingMatchHasNoDemoUrlResultOrFinishTime() throws Exception {
        stubMatch("faceit/match-ongoing.json");

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ONGOING"))
                .andExpect(jsonPath("$.mapName").value("de_mirage"))
                .andExpect(jsonPath("$.startedAt").value("2023-11-14T22:13:20Z"))
                .andExpect(jsonPath("$.finishedAt").value(nullValue()))
                .andExpect(jsonPath("$.demoUrl").value(nullValue()))
                .andExpect(jsonPath("$.winner").value(nullValue()))
                .andExpect(jsonPath("$.teams.length()").value(2));

        assertThat(matches.findByFaceitMatchId(MATCH_ID)).get()
                .extracting(Match::getMapName, Match::getFinishedAt)
                .containsExactly("de_mirage", null);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "",
            ", \"teams\": {}, \"voting\": {}",
            ", \"voting\": {\"map\": {}}",
            ", \"voting\": {\"map\": {\"pick\": []}}, \"demo_url\": []"})
    void matchWithoutPickedMapOrDemoUrlHasNullMapNameAndDemoUrl(String extraFields) throws Exception {
        String body = "{\"match_id\": \"" + MATCH_ID + "\", \"status\": \"READY\"" + extraFields + "}";
        faceit.stubFor(get(urlPathEqualTo(FACEIT_MATCH_PATH)).willReturn(okJson(body)));

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("READY"))
                .andExpect(jsonPath("$.mapName").value(nullValue()))
                .andExpect(jsonPath("$.demoUrl").value(nullValue()))
                .andExpect(jsonPath("$.startedAt").value(nullValue()))
                .andExpect(jsonPath("$.winner").value(nullValue()))
                .andExpect(jsonPath("$.teams.length()").value(0));

        assertThat(matches.findByFaceitMatchId(MATCH_ID)).get()
                .extracting(Match::getMapName, Match::getStartedAt, Match::getFinishedAt)
                .containsExactly(null, null, null);
    }

    @Test
    void unknownMatchReturns404MatchNotFound() throws Exception {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_MATCH_PATH)).willReturn(notFound()));

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MATCH_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("Match not found: " + MATCH_ID));

        assertThat(matches.count()).isZero();
    }

    @Test
    void faceitOutageOnMatchReturns502() throws Exception {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_MATCH_PATH)).willReturn(serviceUnavailable()));

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("FACEIT_UNAVAILABLE"));

        assertThat(matches.count()).isZero();
    }

    @Test
    void emptyFaceitBodyOnMatchReturns502() throws Exception {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_MATCH_PATH)).willReturn(aResponse().withStatus(200)));

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("FACEIT_UNAVAILABLE"));

        assertThat(matches.count()).isZero();
    }

    // ---- GET /api/v1/matches/{matchId}/stats ----

    @Test
    void getStatsReturnsPerPlayerNumbersAndPersistsPlayerMatchStats() throws Exception {
        stubMatch("faceit/match-finished.json");
        stubStats("faceit/match-stats.json");

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID + "/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matchId").value(MATCH_ID))
                .andExpect(jsonPath("$.mapName").value("de_mirage"))
                .andExpect(jsonPath("$.rounds").value(22))
                .andExpect(jsonPath("$.teams.length()").value(2))
                .andExpect(jsonPath("$.teams[0].teamId").value("fac10000-0000-4000-8000-000000000001"))
                .andExpect(jsonPath("$.teams[0].name").value("team_A"))
                .andExpect(jsonPath("$.teams[0].score").value(13))
                .andExpect(jsonPath("$.teams[0].win").value(true))
                .andExpect(jsonPath("$.teams[0].players.length()").value(5))
                .andExpect(jsonPath("$.teams[0].players[0].playerId").value(S1MPLE_ID))
                .andExpect(jsonPath("$.teams[0].players[0].nickname").value("s1mple"))
                .andExpect(jsonPath("$.teams[0].players[0].kills").value(25))
                .andExpect(jsonPath("$.teams[0].players[0].deaths").value(14))
                .andExpect(jsonPath("$.teams[0].players[0].assists").value(3))
                .andExpect(jsonPath("$.teams[0].players[0].headshots").value(12))
                .andExpect(jsonPath("$.teams[0].players[0].kdRatio").value(1.79))
                .andExpect(jsonPath("$.teams[0].players[0].krRatio").value(1.14))
                .andExpect(jsonPath("$.teams[0].players[0].adr").value(95.4))
                .andExpect(jsonPath("$.teams[1].teamId").value("fac10000-0000-4000-8000-000000000002"))
                .andExpect(jsonPath("$.teams[1].name").value("team_B"))
                .andExpect(jsonPath("$.teams[1].score").value(9))
                .andExpect(jsonPath("$.teams[1].win").value(false))
                .andExpect(jsonPath("$.teams[1].players.length()").value(5))
                .andExpect(jsonPath("$.teams[1].players[0].nickname").value("playerB1"))
                .andExpect(jsonPath("$.teams[1].players[0].kills").value(17));

        // The match was not stored before, so requesting its stats stored it first.
        assertThat(matches.findByFaceitMatchId(MATCH_ID)).get()
                .extracting(Match::getMapName).isEqualTo("de_mirage");
        assertThat(players.count()).isEqualTo(10);
        assertThat(playerMatchStats.count()).isEqualTo(10);
        assertThat(statsRowPlayerIds()).containsExactlyInAnyOrderElementsOf(ROSTER_IDS);

        Player s1mple = players.findByFaceitId(S1MPLE_ID).orElseThrow();
        Match match = matches.findByFaceitMatchId(MATCH_ID).orElseThrow();
        PlayerMatchStats row = playerMatchStats.findByPlayerIdAndMatchId(s1mple.getId(), match.getId()).orElseThrow();
        assertThat(row.getKills()).isEqualTo(25);
        assertThat(row.getDeaths()).isEqualTo(14);
        assertThat(row.getAssists()).isEqualTo(3);
        assertThat(row.getHeadshots()).isEqualTo(12);
        assertThat(row.getAdr()).isEqualByComparingTo("95.40");
        assertThat(row.getKast()).isNull();
        assertThat(row.getRating()).isNull();
        assertThat(s1mple.getNickname()).isEqualTo("s1mple");
        assertThat(s1mple.getElo()).isNull();
        assertThat(s1mple.getLevel()).isNull();
    }

    @Test
    void getStatsTwiceDoesNotDuplicateRows() throws Exception {
        stubMatch("faceit/match-finished.json");
        stubStats("faceit/match-stats.json");

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID + "/stats")).andExpect(status().isOk());
        // Damage the stored row: the second call must write the FACEIT numbers back into the same row.
        jdbc.update("UPDATE player_match_stats SET kills = 0, adr = NULL");
        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID + "/stats")).andExpect(status().isOk());

        assertThat(matches.count()).isEqualTo(1);
        assertThat(players.count()).isEqualTo(10);
        assertThat(playerMatchStats.count()).isEqualTo(10);
        Integer s1mpleKills = jdbc.queryForObject("""
                SELECT pms.kills FROM player_match_stats pms JOIN players p ON p.id = pms.player_id
                WHERE p.faceit_id = ?""", Integer.class, S1MPLE_ID);
        assertThat(s1mpleKills).isEqualTo(25);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM player_match_stats WHERE adr IS NULL", Integer.class))
                .isZero();
    }

    @Test
    void getStatsKeepsExistingPlayerEloAndLevelButRefreshesNickname() throws Exception {
        players.save(new Player(S1MPLE_ID, "oldNick", 3500, 10));
        stubMatch("faceit/match-finished.json");
        stubStats("faceit/match-stats.json");

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID + "/stats"))
                .andExpect(status().isOk());

        assertThat(players.count()).isEqualTo(10);
        assertThat(players.findByFaceitId(S1MPLE_ID)).get()
                .extracting(Player::getNickname, Player::getElo, Player::getLevel)
                .containsExactly("s1mple", 3500, 10);
        // The other nine players are new and carry no elo or level.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM players WHERE elo IS NULL AND level IS NULL",
                Integer.class)).isEqualTo(9);
    }

    @Test
    void getStatsDoesNotFetchTheMatchAgainWhenItIsAlreadyStored() throws Exception {
        matches.save(new Match(MATCH_ID, "de_mirage", Instant.ofEpochSecond(1700000000L),
                Instant.ofEpochSecond(1700002400L)));
        stubStats("faceit/match-stats.json");

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID + "/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rounds").value(22));

        faceit.verify(0, getRequestedFor(urlPathEqualTo(FACEIT_MATCH_PATH)));
        assertThat(matches.count()).isEqualTo(1);
        assertThat(playerMatchStats.count()).isEqualTo(10);
    }

    @Test
    void missingEmptyOrNonNumericStatValuesBecomeZero() throws Exception {
        stubMatch("faceit/match-finished.json");
        faceit.stubFor(get(urlPathEqualTo(FACEIT_STATS_PATH)).willReturn(okJson("""
                {"rounds": [{
                  "round_stats": {"Map": "de_mirage"},
                  "teams": [{
                    "team_id": "t1",
                    "team_stats": {"Team": "team_A", "Final Score": "n/a"},
                    "players": [{
                      "player_id": "11111111-1111-1111-1111-111111111111",
                      "nickname": "s1mple",
                      "player_stats": {"Kills": "", "Deaths": "many", "Headshots": "12", "ADR": "NaN", "K/D Ratio": "oops"}
                    }]
                  }]
                }]}
                """)));

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID + "/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rounds").value(0))
                .andExpect(jsonPath("$.teams[0].score").value(0))
                .andExpect(jsonPath("$.teams[0].win").value(false))
                .andExpect(jsonPath("$.teams[0].players[0].kills").value(0))
                .andExpect(jsonPath("$.teams[0].players[0].deaths").value(0))
                .andExpect(jsonPath("$.teams[0].players[0].assists").value(0))
                .andExpect(jsonPath("$.teams[0].players[0].headshots").value(12))
                .andExpect(jsonPath("$.teams[0].players[0].kdRatio").value(0.0))
                .andExpect(jsonPath("$.teams[0].players[0].krRatio").value(0.0))
                .andExpect(jsonPath("$.teams[0].players[0].adr").value(0.0));

        Map<String, Object> row = jdbc.queryForMap("""
                SELECT pms.kills, pms.deaths, pms.assists, pms.headshots, pms.adr
                FROM player_match_stats pms JOIN players p ON p.id = pms.player_id WHERE p.faceit_id = ?""",
                S1MPLE_ID);
        assertThat(row).containsEntry("kills", 0).containsEntry("deaths", 0).containsEntry("assists", 0)
                .containsEntry("headshots", 12);
        assertThat((BigDecimal) row.get("adr")).isEqualByComparingTo("0");
        assertThat(playerMatchStats.count()).isEqualTo(1);
    }

    @Test
    void statsOfUnknownMatchReturn404WithoutAskingForStats() throws Exception {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_MATCH_PATH)).willReturn(notFound()));

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID + "/stats"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MATCH_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("Match not found: " + MATCH_ID));

        faceit.verify(0, getRequestedFor(urlPathEqualTo(FACEIT_STATS_PATH)));
        assertThat(matches.count()).isZero();
        assertThat(playerMatchStats.count()).isZero();
    }

    @Test
    void matchWithoutPublishedStatsReturns404MatchNotFound() throws Exception {
        stubMatch("faceit/match-ongoing.json");
        faceit.stubFor(get(urlPathEqualTo(FACEIT_STATS_PATH)).willReturn(notFound()));

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID + "/stats"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MATCH_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("Match stats not found: " + MATCH_ID));

        assertThat(playerMatchStats.count()).isZero();
        assertThat(players.count()).isZero();
    }

    @Test
    void emptyFaceitBodyOnStatsReturns502() throws Exception {
        stubMatch("faceit/match-finished.json");
        faceit.stubFor(get(urlPathEqualTo(FACEIT_STATS_PATH)).willReturn(aResponse().withStatus(200)));

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + MATCH_ID + "/stats"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("FACEIT_UNAVAILABLE"));

        assertThat(playerMatchStats.count()).isZero();
        assertThat(players.count()).isZero();
    }

    // ---- matchId validation (both routes) ----

    @ParameterizedTest
    @ValueSource(strings = {"bad:id", "bad.id", "bad id", "bad_id", "bad*id",
            "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"})
    void matchIdWithIllegalCharactersOrLengthReturns400(String matchId) throws Exception {
        for (String suffix : new String[] {"", "/stats"}) {
            mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + matchId + suffix))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.message").value(startsWith("matchId must be 1-64 characters")));
        }

        faceit.verify(0, anyRequestedFor(anyUrl()));
        assertThat(matches.count()).isZero();
    }

    @Test
    void matchIdOfSixtyFourCharactersIsAccepted() throws Exception {
        String matchId = "a".repeat(64);
        faceit.stubFor(get(urlPathEqualTo("/matches/" + matchId))
                .willReturn(okJson(fixture("faceit/match-finished.json"))));

        mvc.perform(MockMvcRequestBuilders.get(MATCHES_URL + "/" + matchId))
                .andExpect(status().isOk());
    }

    private static void stubMatch(String fixturePath) {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_MATCH_PATH)).willReturn(okJson(fixture(fixturePath))));
    }

    private static void stubStats(String fixturePath) {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_STATS_PATH)).willReturn(okJson(fixture(fixturePath))));
    }

    /** FACEIT ids of the players owning the stored {@code player_match_stats} rows. */
    private List<String> statsRowPlayerIds() {
        return jdbc.queryForList("""
                SELECT p.faceit_id FROM player_match_stats pms JOIN players p ON p.id = pms.player_id""",
                String.class);
    }
}
