package io.csfaceit.backend.match;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Level;
import io.csfaceit.backend.LogCapture;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.FaceitNotFoundException;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchStats;
import io.csfaceit.backend.faceit.dto.FaceitResults;
import io.csfaceit.backend.faceit.dto.FaceitStatsPlayer;
import io.csfaceit.backend.faceit.dto.FaceitStatsRound;
import io.csfaceit.backend.faceit.dto.FaceitStatsTeam;
import io.csfaceit.backend.faceit.dto.FaceitVoting;
import io.csfaceit.backend.faceit.dto.FaceitVotingMap;
import io.csfaceit.backend.match.dto.MatchResponse;
import io.csfaceit.backend.match.dto.MatchStatsResponse;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InOrder;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * Unit tests of {@link MatchService} without Spring: the statistic parsing helpers (FACEIT sends every statistic as
 * a string and a bad value must never fail a request) and the retry around the persistence step.
 */
class MatchServiceTest {

    private static final String MATCH_ID = "1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    private FaceitGateway faceit;
    private MatchRepository matches;
    private MatchPersistence persistence;
    private MatchService service;

    /** The service logs every retry at INFO; capturing keeps that off the console and lets tests assert on it. */
    private LogCapture logs;

    @BeforeEach
    void setUp() {
        faceit = mock(FaceitGateway.class);
        matches = mock(MatchRepository.class);
        persistence = mock(MatchPersistence.class);
        service = new MatchService(faceit, matches, persistence);
        logs = LogCapture.of(MatchService.class);
    }

    @AfterEach
    void tearDown() {
        logs.close();
    }

    @Test
    void intStatParsesAValidValue() {
        assertThat(MatchService.intStat(Map.of("Kills", "25"), "Kills")).isEqualTo(25);
        assertThat(MatchService.intStat(Map.of("Kills", " 25 "), "Kills")).isEqualTo(25);
    }

    @Test
    void intStatIsZeroForAMissingKey() {
        assertThat(MatchService.intStat(Map.of("Deaths", "14"), "Kills")).isZero();
    }

    @Test
    void intStatIsZeroWhenTheWholeMapIsMissing() {
        assertThat(MatchService.intStat(null, "Kills")).isZero();
    }

    @Test
    void intStatIsZeroForANullValue() {
        Map<String, String> stats = new HashMap<>();
        stats.put("Kills", null);

        assertThat(MatchService.intStat(stats, "Kills")).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "abc", "1.5", "99999999999", "12 / 9"})
    void intStatIsZeroForAnEmptyOrNonNumericValue(String value) {
        assertThat(MatchService.intStat(Map.of("Kills", value), "Kills")).isZero();
    }

    @Test
    void doubleStatParsesAValidValue() {
        assertThat(MatchService.doubleStat(Map.of("ADR", "95.4"), "ADR")).isEqualTo(95.4);
        assertThat(MatchService.doubleStat(Map.of("K/D Ratio", "1"), "K/D Ratio")).isEqualTo(1.0);
    }

    @Test
    void doubleStatIsZeroForAMissingKey() {
        assertThat(MatchService.doubleStat(Map.of("ADR", "95.4"), "K/R Ratio")).isZero();
    }

    @Test
    void doubleStatIsZeroWhenTheWholeMapIsMissing() {
        assertThat(MatchService.doubleStat(null, "ADR")).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "abc", "1,5", "NaN", "Infinity", "-Infinity"})
    void doubleStatIsZeroForAnEmptyNonNumericOrNonFiniteValue(String value) {
        assertThat(MatchService.doubleStat(Map.of("ADR", value), "ADR")).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"-1", "-0.01", "10000", "1e9", "9999.995"})
    void doubleStatIsZeroForAValueThatDoesNotFitTheNumeric62Column(String value) {
        assertThat(MatchService.doubleStat(Map.of("ADR", value), "ADR")).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "9999.99", "9999.9949"})
    void doubleStatKeepsTheLargestValuesThatStillFitTheColumn(String value) {
        assertThat(MatchService.doubleStat(Map.of("ADR", value), "ADR")).isEqualTo(Double.parseDouble(value));
    }

    // ---- retry of the persistence step ----

    @Test
    void getMatchRetriesThePersistOnceWhenItLosesAWriteRace() {
        when(faceit.getMatch(MATCH_ID)).thenReturn(finishedMatch());
        doThrow(new DataIntegrityViolationException("duplicate key")).doNothing()
                .when(persistence).storeMatch(anyString(), any(), any(), any());

        MatchResponse response = service.getMatch(MATCH_ID);

        assertThat(response.matchId()).isEqualTo(MATCH_ID);
        assertThat(response.mapName()).isEqualTo("de_mirage");
        assertThat(response.winner()).isEqualTo("faction1");
        verify(persistence, times(2)).storeMatch(MATCH_ID, "de_mirage", Instant.ofEpochSecond(1700000000L),
                Instant.ofEpochSecond(1700002400L));
        // FACEIT is asked once: only the persist step is repeated.
        verify(faceit, times(1)).getMatch(MATCH_ID);
        assertThat(logs.events(Level.INFO)).singleElement().satisfies(event -> assertThat(event.getFormattedMessage())
                .isEqualTo("Lost a concurrent first-access write race for match " + MATCH_ID
                        + " (DataIntegrityViolationException), retrying once"));
    }

    @Test
    void getMatchGivesUpWhenTheSecondPersistLosesTheRaceToo() {
        when(faceit.getMatch(MATCH_ID)).thenReturn(finishedMatch());
        DataIntegrityViolationException second = new DataIntegrityViolationException("second duplicate key");
        doThrow(new DataIntegrityViolationException("duplicate key")).doThrow(second)
                .when(persistence).storeMatch(anyString(), any(), any(), any());

        assertThatThrownBy(() -> service.getMatch(MATCH_ID)).isSameAs(second);

        verify(persistence, times(2)).storeMatch(anyString(), any(), any(), any());
    }

    @Test
    void getMatchRetriesOnceAfterADeadlock() {
        when(faceit.getMatch(MATCH_ID)).thenReturn(finishedMatch());
        doThrow(new CannotAcquireLockException("deadlock detected")).doNothing()
                .when(persistence).storeMatch(anyString(), any(), any(), any());

        assertThat(service.getMatch(MATCH_ID).matchId()).isEqualTo(MATCH_ID);

        verify(persistence, times(2)).storeMatch(anyString(), any(), any(), any());
    }

    @Test
    void getMatchDoesNotRetryOtherFailures() {
        when(faceit.getMatch(MATCH_ID)).thenReturn(finishedMatch());
        IllegalStateException failure = new IllegalStateException("boom");
        doThrow(failure).when(persistence).storeMatch(anyString(), any(), any(), any());

        assertThatThrownBy(() -> service.getMatch(MATCH_ID)).isSameAs(failure);

        verify(persistence, times(1)).storeMatch(anyString(), any(), any(), any());
    }

    @Test
    void getMatchStoresNothingWhenFaceitDoesNotKnowTheMatch() {
        when(faceit.getMatch(MATCH_ID)).thenThrow(new FaceitNotFoundException("no match"));

        assertThatThrownBy(() -> service.getMatch(MATCH_ID))
                .isInstanceOfSatisfying(NotFoundException.class,
                        e -> assertThat(e.getCode()).isEqualTo("MATCH_NOT_FOUND"));

        verifyNoInteractions(persistence);
    }

    @Test
    void getStatsOfAStoredMatchRetriesThePersistOnceAndDoesNotFetchTheMatch() {
        when(matches.findByFaceitMatchId(MATCH_ID)).thenReturn(Optional.of(new Match(MATCH_ID, null, null, null)));
        when(faceit.getMatchStats(MATCH_ID)).thenReturn(oneRoundOnePlayer());
        doThrow(new DataIntegrityViolationException("duplicate key")).doNothing()
                .when(persistence).storeStats(eq(MATCH_ID), any(MatchStatsResponse.class));

        MatchStatsResponse response = service.getStats(MATCH_ID);

        assertThat(response.rounds()).isEqualTo(22);
        verify(persistence, times(2)).storeStats(MATCH_ID, response);
        verify(faceit, never()).getMatch(anyString());
        verify(persistence, never()).storeMatch(anyString(), any(), any(), any());
    }

    @Test
    void getStatsOfAnUnstoredMatchStoresTheMatchBeforeTheStats() {
        when(matches.findByFaceitMatchId(MATCH_ID)).thenReturn(Optional.empty());
        when(faceit.getMatch(MATCH_ID)).thenReturn(finishedMatch());
        when(faceit.getMatchStats(MATCH_ID)).thenReturn(oneRoundOnePlayer());
        doNothing().when(persistence).storeMatch(anyString(), any(), any(), any());

        service.getStats(MATCH_ID);

        InOrder order = inOrder(persistence);
        order.verify(persistence).storeMatch(eq(MATCH_ID), eq("de_mirage"), any(), any());
        order.verify(persistence).storeStats(eq(MATCH_ID), any(MatchStatsResponse.class));
    }

    private static FaceitMatch finishedMatch() {
        return new FaceitMatch(MATCH_ID, "FINISHED", 1700000000L, 1700002400L, Map.of(),
                new FaceitVoting(new FaceitVotingMap(List.of("de_mirage"))),
                new FaceitResults("faction1", Map.of("faction1", 13, "faction2", 9)),
                List.of("https://demos.example/1.dem.gz"));
    }

    private static FaceitMatchStats oneRoundOnePlayer() {
        FaceitStatsPlayer player = new FaceitStatsPlayer("11111111-1111-1111-1111-111111111111", "s1mple",
                Map.of("Kills", "25"));
        FaceitStatsTeam team = new FaceitStatsTeam("t1", Map.of("Team", "team_A"), List.of(player));
        return new FaceitMatchStats(List.of(new FaceitStatsRound(Map.of("Map", "de_mirage", "Rounds", "22"),
                List.of(team))));
    }
}
