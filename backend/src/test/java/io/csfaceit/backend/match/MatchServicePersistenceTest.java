package io.csfaceit.backend.match;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Level;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.AbstractIntegrationTest;
import io.csfaceit.backend.LogCapture;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchStats;
import io.csfaceit.backend.player.Player;
import io.csfaceit.backend.player.PlayerRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The transaction boundaries of {@link MatchService}: FACEIT is called with no transaction open, and a persist step
 * that loses a first-access write race against a concurrent request is repeated and succeeds.
 */
class MatchServicePersistenceTest extends AbstractIntegrationTest {

    private static final String MATCH_ID = "1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    private static final String S1MPLE_ID = "11111111-1111-1111-1111-111111111111";
    private static final String MATCH_URL = "/api/v1/matches/" + MATCH_ID;
    private static final String STATS_URL = MATCH_URL + "/stats";
    private static final String FACEIT_MATCH_PATH = "/matches/" + MATCH_ID;
    private static final String FACEIT_STATS_PATH = FACEIT_MATCH_PATH + "/stats";

    @Autowired
    MatchRepository matches;

    @Autowired
    PlayerRepository players;

    @Autowired
    PlayerMatchStatsRepository playerMatchStats;

    @Autowired
    MatchPersistence persistence;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    JdbcTemplate jdbc;

    private ExecutorService pool;

    /** The retry is logged by the service; the lost race itself is logged by Hibernate. Both stay off the console. */
    private LogCapture serviceLogs;
    private LogCapture sqlLogs;

    @BeforeEach
    void setUp() {
        pool = Executors.newFixedThreadPool(8);
        serviceLogs = LogCapture.of(MatchService.class);
        sqlLogs = LogCapture.of("org.hibernate.engine.jdbc.spi.SqlExceptionHelper");
    }

    @AfterEach
    void tearDown() {
        pool.shutdownNow();
        serviceLogs.close();
        sqlLogs.close();
    }

    // ---- no transaction across FACEIT calls ----

    @Test
    void noTransactionIsOpenWhileFaceitIsCalled() throws Exception {
        List<Boolean> transactionActive = new CopyOnWriteArrayList<>();
        FaceitGateway gateway = mock(FaceitGateway.class);
        when(gateway.getMatch(MATCH_ID)).thenAnswer(invocation -> {
            transactionActive.add(TransactionSynchronizationManager.isActualTransactionActive());
            return mapper.readValue(fixture("faceit/match-finished.json"), FaceitMatch.class);
        });
        when(gateway.getMatchStats(MATCH_ID)).thenAnswer(invocation -> {
            transactionActive.add(TransactionSynchronizationManager.isActualTransactionActive());
            return mapper.readValue(fixture("faceit/match-stats.json"), FaceitMatchStats.class);
        });
        MatchService service = new MatchService(gateway, matches, persistence);

        // The probe must be able to see a transaction at all.
        Boolean activeInsideTemplate = new TransactionTemplate(transactionManager)
                .execute(status -> TransactionSynchronizationManager.isActualTransactionActive());
        assertThat(activeInsideTemplate).isTrue();

        service.getStats(MATCH_ID);   // loads the unseen match first, then the stats
        service.getMatch(MATCH_ID);

        assertThat(transactionActive).containsExactly(false, false, false);
        // The rows were still written, each persist step in a transaction of its own.
        assertThat(matches.count()).isEqualTo(1);
        assertThat(players.count()).isEqualTo(10);
        assertThat(playerMatchStats.count()).isEqualTo(10);
    }

    // ---- losing the first-access race, deterministically ----

    @Test
    void matchRowInsertedByAConcurrentRequestIsUpdatedAfterOneRetry() throws Exception {
        stubFaceit();

        MvcResult result = requestWhileHolding(
                () -> matches.save(new Match(MATCH_ID, "de_old", Instant.ofEpochSecond(1L), null)), MATCH_URL);

        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        assertThat(result.getResponse().getContentAsString()).contains("\"mapName\":\"de_mirage\"");
        assertThat(matches.count()).isEqualTo(1);
        assertThat(matches.findByFaceitMatchId(MATCH_ID)).get()
                .extracting(Match::getMapName, Match::getStartedAt, Match::getFinishedAt)
                .containsExactly("de_mirage", Instant.ofEpochSecond(1700000000L), Instant.ofEpochSecond(1700002400L));
        assertThat(retries()).isEqualTo(1);
    }

    @Test
    void playerRowInsertedByAConcurrentRequestIsReusedAfterOneRetry() throws Exception {
        stubFaceit();
        matches.save(new Match(MATCH_ID, "de_mirage", null, null));

        MvcResult result = requestWhileHolding(
                () -> players.save(new Player(S1MPLE_ID, "oldNick", 3500, 10)), STATS_URL);

        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        assertThat(players.count()).isEqualTo(10);
        assertThat(playerMatchStats.count()).isEqualTo(10);
        // The row the concurrent request created is the one that was updated: its elo and level survived.
        assertThat(players.findByFaceitId(S1MPLE_ID)).get()
                .extracting(Player::getNickname, Player::getElo, Player::getLevel)
                .containsExactly("s1mple", 3500, 10);
        assertThat(retries()).isEqualTo(1);
    }

    @Test
    void statsRowInsertedByAConcurrentRequestIsUpdatedAfterOneRetry() throws Exception {
        stubFaceit();
        Match match = matches.save(new Match(MATCH_ID, "de_mirage", null, null));
        Player s1mple = players.save(new Player(S1MPLE_ID, "s1mple", null, null));

        MvcResult result = requestWhileHolding(() -> {
            PlayerMatchStats stale = new PlayerMatchStats(s1mple, match);
            stale.setKills(1);
            playerMatchStats.save(stale);
        }, STATS_URL);

        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        assertThat(playerMatchStats.count()).isEqualTo(10);
        assertThat(jdbc.queryForObject("""
                SELECT pms.kills FROM player_match_stats pms JOIN players p ON p.id = pms.player_id
                WHERE p.faceit_id = ?""", Integer.class, S1MPLE_ID)).isEqualTo(25);
        assertThat(retries()).isEqualTo(1);
    }

    // ---- losing the first-access race, for real ----

    /**
     * Cold match, requests for the match and its stats fired together while FACEIT is slow, so every request
     * misses the cache and reaches the persist step at the same moment. Whether a request actually loses a write
     * race depends on timing (the deterministic tests above prove the recovery); what must hold in every round is
     * that nobody gets an error and nothing is stored twice.
     */
    @Test
    void parallelFirstRequestsForAColdMatchAllSucceedAndStoreEachRowOnce() throws Exception {
        int pairs = 3;
        for (int round = 0; round < 3; round++) {
            resetState();
            faceit.stubFor(get(urlPathEqualTo(FACEIT_MATCH_PATH)).willReturn(aResponse().withStatus(200)
                    .withHeader("Content-Type", "application/json").withFixedDelay(300)
                    .withBody(fixture("faceit/match-finished.json"))));
            faceit.stubFor(get(urlPathEqualTo(FACEIT_STATS_PATH)).willReturn(aResponse().withStatus(200)
                    .withHeader("Content-Type", "application/json").withFixedDelay(300)
                    .withBody(fixture("faceit/match-stats.json"))));

            CountDownLatch ready = new CountDownLatch(2 * pairs);
            CountDownLatch go = new CountDownLatch(1);
            List<Future<Integer>> statuses = new ArrayList<>();
            for (int i = 0; i < pairs; i++) {
                for (String url : new String[] {MATCH_URL, STATS_URL}) {
                    statuses.add(pool.submit(() -> {
                        ready.countDown();
                        go.await();
                        return mvc.perform(MockMvcRequestBuilders.get(url)).andReturn().getResponse().getStatus();
                    }));
                }
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            go.countDown();

            for (Future<Integer> status : statuses) {
                assertThat(status.get(30, TimeUnit.SECONDS)).as("round %d", round).isEqualTo(200);
            }
            assertThat(matches.count()).as("round %d matches", round).isEqualTo(1);
            assertThat(players.count()).as("round %d players", round).isEqualTo(10);
            assertThat(playerMatchStats.count()).as("round %d stats rows", round).isEqualTo(10);
        }
        // Guards against the test going vacuous: with this setup the races are lost in every round (7 retries per
        // round when written), so at least one retry over three rounds is not a timing coincidence.
        assertThat(retries()).as("retries over all rounds").isPositive();
    }

    private static void stubFaceit() {
        faceit.stubFor(get(urlPathEqualTo(FACEIT_MATCH_PATH)).willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/json").withBody(fixture("faceit/match-finished.json"))));
        faceit.stubFor(get(urlPathEqualTo(FACEIT_STATS_PATH)).willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/json").withBody(fixture("faceit/match-stats.json"))));
    }

    /**
     * Makes a request lose a write race on purpose. Another transaction inserts a row and keeps it uncommitted;
     * the request does not see the row, tries to insert the same one and blocks on the unique index. Once it is
     * waiting, the other transaction commits, so PostgreSQL fails the request's insert with a unique violation.
     */
    private MvcResult requestWhileHolding(Runnable insertUncommitted, String url) throws Exception {
        CountDownLatch inserted = new CountDownLatch(1);
        CountDownLatch commit = new CountDownLatch(1);
        Future<?> holder = pool.submit(() -> new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            insertUncommitted.run();
            inserted.countDown();
            try {
                assertThat(commit.await(30, TimeUnit.SECONDS)).isTrue();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }));
        assertThat(inserted.await(10, TimeUnit.SECONDS)).isTrue();

        Future<MvcResult> request = pool.submit(() -> mvc.perform(MockMvcRequestBuilders.get(url)).andReturn());
        await().atMost(Duration.ofSeconds(10)).pollInterval(Duration.ofMillis(20))
                .until(() -> jdbc.queryForObject(
                        "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'", Integer.class) > 0);
        commit.countDown();

        holder.get(10, TimeUnit.SECONDS);
        return request.get(30, TimeUnit.SECONDS);
    }

    private long retries() {
        return serviceLogs.events(Level.INFO).stream()
                .filter(event -> event.getFormattedMessage().contains("retrying"))
                .count();
    }
}
