package io.csfaceit.backend.match;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariDataSource;
import io.csfaceit.backend.AbstractIntegrationTest;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchStats;
import io.csfaceit.backend.player.PlayerRepository;
import java.sql.SQLException;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * FACEIT must be called with no transaction open and no database connection held. The real, Spring-managed
 * {@link MatchService} bean is driven (a hand-built instance would bypass the transaction proxy that this is about),
 * with the FACEIT gateway replaced by a mock that inspects the calling thread when it is called.
 *
 * <p>Declaring the same {@code httpFaceitGateway} override as the caching gateway tests lets Spring reuse their
 * cached context.
 */
class MatchServiceTransactionTest extends AbstractIntegrationTest {

    private static final String MATCH_ID = "1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    /** What the code that is calling FACEIT holds at that moment. */
    private record Held(boolean transaction, int connections) {
    }

    @MockitoBean(name = "httpFaceitGateway")
    FaceitGateway delegate;

    @Autowired
    MatchService service;

    @Autowired
    MatchRepository matches;

    @Autowired
    PlayerRepository players;

    @Autowired
    PlayerMatchStatsRepository playerMatchStats;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Autowired
    DataSource dataSource;

    @Autowired
    ObjectMapper mapper;

    private final List<Held> heldDuringFaceitCalls = new CopyOnWriteArrayList<>();

    @Test
    void probeSeesATransactionAndItsConnection() {
        Held[] held = new Held[1];

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            matches.count();   // runs a statement, as every real persist step does
            held[0] = held();
        });

        assertThat(held[0].transaction()).isTrue();
        assertThat(held[0].connections()).isPositive();
        assertThat(held()).isEqualTo(new Held(false, 0));
    }

    @Test
    void getMatchCallsFaceitWithNoTransactionAndNoConnectionHeld() throws Exception {
        recordWhenFaceitIsAsked();

        service.getMatch(MATCH_ID);

        assertThat(heldDuringFaceitCalls).containsExactly(new Held(false, 0));
        // Each persist step still ran in a transaction of its own.
        assertThat(matches.count()).isEqualTo(1);
    }

    @Test
    void getStatsCallsFaceitWithNoTransactionAndNoConnectionHeld() throws Exception {
        recordWhenFaceitIsAsked();

        service.getStats(MATCH_ID);   // the match is unseen: its fetch comes first, then the stats fetch

        assertThat(heldDuringFaceitCalls).containsExactly(new Held(false, 0), new Held(false, 0));
        assertThat(matches.count()).isEqualTo(1);
        assertThat(players.count()).isEqualTo(10);
        assertThat(playerMatchStats.count()).isEqualTo(10);
    }

    private void recordWhenFaceitIsAsked() throws Exception {
        FaceitMatch match = mapper.readValue(fixture("faceit/match-finished.json"), FaceitMatch.class);
        FaceitMatchStats stats = mapper.readValue(fixture("faceit/match-stats.json"), FaceitMatchStats.class);
        when(delegate.getMatch(MATCH_ID)).thenAnswer(invocation -> {
            heldDuringFaceitCalls.add(held());
            return match;
        });
        when(delegate.getMatchStats(MATCH_ID)).thenAnswer(invocation -> {
            heldDuringFaceitCalls.add(held());
            return stats;
        });
    }

    /** The calling thread's transaction state and the number of database connections checked out of the pool. */
    private Held held() {
        try {
            int connections = dataSource.unwrap(HikariDataSource.class).getHikariPoolMXBean().getActiveConnections();
            return new Held(TransactionSynchronizationManager.isActualTransactionActive(), connections);
        } catch (SQLException e) {
            throw new IllegalStateException("The data source is not a HikariDataSource", e);
        }
    }
}
