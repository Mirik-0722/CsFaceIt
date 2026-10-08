package io.csfaceit.backend.faceit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.AbstractIntegrationTest;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchHistory;
import io.csfaceit.backend.faceit.dto.FaceitMatchStats;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import java.io.UncheckedIOException;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@ExtendWith(OutputCaptureExtension.class)
class CachingFaceitGatewayTest extends AbstractIntegrationTest {

    private static final long FIVE_MINUTES = TimeUnit.MINUTES.toSeconds(5);
    private static final long TWO_MINUTES = TimeUnit.MINUTES.toSeconds(2);
    private static final long ONE_DAY = TimeUnit.DAYS.toSeconds(1);
    private static final long SEVEN_DAYS = TimeUnit.DAYS.toSeconds(7);
    private static final long THIRTY_SECONDS = 30;

    /** Replaces the {@link HttpFaceitGateway} bean; the decorator under test wraps this mock. */
    @MockitoBean(name = "httpFaceitGateway")
    FaceitGateway delegate;

    @Autowired
    FaceitGateway gateway;

    @Autowired
    StringRedisTemplate redis;

    @Autowired
    ObjectMapper mapper;

    @Test
    void injectedGatewayIsTheCachingDecorator() {
        assertThat(gateway).isInstanceOf(CachingFaceitGateway.class);
    }

    @Test
    void secondPlayerCallIsServedFromCacheWithFiveMinuteTtl() {
        FaceitPlayer player = player();
        when(delegate.getPlayer("p1")).thenReturn(player);

        FaceitPlayer first = gateway.getPlayer("p1");
        FaceitPlayer second = gateway.getPlayer("p1");

        verify(delegate, times(1)).getPlayer("p1");
        assertThat(first).isSameAs(player);
        assertThat(second).isEqualTo(player);
        assertThat(ttl("faceit:player:p1")).isBetween(FIVE_MINUTES - 10, FIVE_MINUTES);
    }

    @Test
    void playerSearchIsCachedUnderLowercasedNicknameWithFiveMinuteTtl() {
        FaceitPlayer player = player();
        when(delegate.findPlayerByNickname("S1mple")).thenReturn(player);

        gateway.findPlayerByNickname("S1mple");
        FaceitPlayer second = gateway.findPlayerByNickname("s1MPLE");

        verify(delegate, times(1)).findPlayerByNickname(any());
        assertThat(second).isEqualTo(player);
        assertThat(ttl("faceit:player-search:s1mple")).isBetween(FIVE_MINUTES - 10, FIVE_MINUTES);
        assertThat(ttl("faceit:stale:player-search:s1mple")).isBetween(SEVEN_DAYS - 10, SEVEN_DAYS);
    }

    @Test
    void historyIsCachedWithTwoMinuteTtl() {
        FaceitMatchHistory history = fixtureAs("faceit/history.json", FaceitMatchHistory.class);
        when(delegate.getHistory("p1", 0, 20)).thenReturn(history);

        gateway.getHistory("p1", 0, 20);
        FaceitMatchHistory second = gateway.getHistory("p1", 0, 20);

        verify(delegate, times(1)).getHistory("p1", 0, 20);
        assertThat(second).isEqualTo(history);
        assertThat(ttl("faceit:history:p1:0:20")).isBetween(TWO_MINUTES - 10, TWO_MINUTES);
    }

    @Test
    void historyPagesAreCachedUnderSeparateKeys() {
        FaceitMatchHistory history = fixtureAs("faceit/history.json", FaceitMatchHistory.class);
        when(delegate.getHistory(any(), anyInt(), anyInt())).thenReturn(history);

        gateway.getHistory("p1", 0, 20);
        gateway.getHistory("p1", 20, 20);
        gateway.getHistory("p1", 0, 10);

        verify(delegate).getHistory("p1", 0, 20);
        verify(delegate).getHistory("p1", 20, 20);
        verify(delegate).getHistory("p1", 0, 10);
        assertThat(redis.keys("faceit:history:*"))
                .containsExactlyInAnyOrder("faceit:history:p1:0:20", "faceit:history:p1:20:20",
                        "faceit:history:p1:0:10");
    }

    @Test
    void finishedMatchIsCachedFor24Hours() {
        FaceitMatch match = fixtureAs("faceit/match-finished.json", FaceitMatch.class);
        when(delegate.getMatch("m1")).thenReturn(match);

        gateway.getMatch("m1");
        FaceitMatch second = gateway.getMatch("m1");

        verify(delegate, times(1)).getMatch("m1");
        assertThat(second).isEqualTo(match);
        assertThat(ttl("faceit:match:m1")).isBetween(ONE_DAY - 400, ONE_DAY);
    }

    @Test
    void unfinishedMatchIsCachedForShortTtlButItsStaleCopyKeepsSevenDays() {
        FaceitMatch match = fixtureAs("faceit/match-ongoing.json", FaceitMatch.class);
        when(delegate.getMatch("m1")).thenReturn(match);

        gateway.getMatch("m1");

        assertThat(match.status()).isEqualTo("ONGOING");
        assertThat(ttl("faceit:match:m1")).isBetween(THIRTY_SECONDS - 5, THIRTY_SECONDS);
        assertThat(ttl("faceit:stale:match:m1")).isBetween(SEVEN_DAYS - 10, SEVEN_DAYS);
    }

    @Test
    void matchStatsAreCachedFor24Hours() {
        FaceitMatchStats stats = fixtureAs("faceit/match-stats.json", FaceitMatchStats.class);
        when(delegate.getMatchStats("m1")).thenReturn(stats);

        gateway.getMatchStats("m1");
        FaceitMatchStats second = gateway.getMatchStats("m1");

        verify(delegate, times(1)).getMatchStats("m1");
        assertThat(second).isEqualTo(stats);
        assertThat(ttl("faceit:match-stats:m1")).isBetween(ONE_DAY - 400, ONE_DAY);
        assertThat(ttl("faceit:stale:match-stats:m1")).isBetween(SEVEN_DAYS - 10, SEVEN_DAYS);
    }

    @Test
    void successfulLoadAlsoWritesStaleCopyWithSevenDayTtl() {
        FaceitPlayer player = player();
        when(delegate.getPlayer("p1")).thenReturn(player);

        gateway.getPlayer("p1");

        assertThat(redis.hasKey("faceit:stale:player:p1")).isTrue();
        assertThat(ttl("faceit:stale:player:p1")).isBetween(SEVEN_DAYS - 10, SEVEN_DAYS);
    }

    @Test
    void staleCopyIsReturnedWhenDelegateIsUnavailable() {
        FaceitPlayer player = player();
        when(delegate.getPlayer("p1")).thenReturn(player).thenThrow(new FaceitUnavailableException("503"));

        gateway.getPlayer("p1");
        redis.delete("faceit:player:p1");
        FaceitPlayer served = gateway.getPlayer("p1");

        assertThat(served).isEqualTo(player);
        verify(delegate, times(2)).getPlayer("p1");
    }

    @Test
    void unavailableWithoutStaleCopyRethrows() {
        FaceitUnavailableException unavailable = new FaceitUnavailableException("503");
        when(delegate.getPlayer("p1")).thenThrow(unavailable);

        assertThatThrownBy(() -> gateway.getPlayer("p1")).isSameAs(unavailable);

        assertThat(redis.keys("faceit:*")).isEmpty();
    }

    @Test
    void notFoundIsNotCachedAndLeavesNoFreshOrStaleKey() {
        when(delegate.getPlayer("ghost")).thenThrow(new FaceitNotFoundException("no ghost"));

        assertThatThrownBy(() -> gateway.getPlayer("ghost")).isInstanceOf(FaceitNotFoundException.class);
        assertThatThrownBy(() -> gateway.getPlayer("ghost")).isInstanceOf(FaceitNotFoundException.class);

        verify(delegate, times(2)).getPlayer("ghost");
        assertThat(redis.hasKey("faceit:player:ghost")).isFalse();
        assertThat(redis.hasKey("faceit:stale:player:ghost")).isFalse();
    }

    @Test
    void notFoundDoesNotFallBackToStaleCopy() {
        when(delegate.getPlayer("p1")).thenReturn(player()).thenThrow(new FaceitNotFoundException("gone"));

        gateway.getPlayer("p1");
        redis.delete("faceit:player:p1");

        assertThat(redis.hasKey("faceit:stale:player:p1")).isTrue();
        assertThatThrownBy(() -> gateway.getPlayer("p1")).isInstanceOf(FaceitNotFoundException.class);
    }

    @Test
    void nullFromDelegateIsReturnedAndNotCached() {
        when(delegate.getMatch("m1")).thenReturn(null);

        assertThat(gateway.getMatch("m1")).isNull();

        assertThat(redis.keys("faceit:*")).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{not json", "", "[1,2]", "42"})
    void unreadableFreshValueIsTreatedAsMissAndOverwritten(String corrupt, CapturedOutput output) {
        FaceitPlayer player = player();
        redis.opsForValue().set("faceit:player:p1", corrupt);
        when(delegate.getPlayer("p1")).thenReturn(player);

        FaceitPlayer first = gateway.getPlayer("p1");
        FaceitPlayer second = gateway.getPlayer("p1");

        assertThat(first).isSameAs(player);
        assertThat(second).isEqualTo(player);
        // The second call is a hit: the unreadable value was replaced by a valid copy.
        verify(delegate, times(1)).getPlayer("p1");
        assertThat(output).contains("WARN").contains("faceit:player:p1");
    }

    @Test
    void unreadableStaleCopyCountsAsMissWhenDelegateIsUnavailable(CapturedOutput output) {
        FaceitUnavailableException unavailable = new FaceitUnavailableException("503");
        redis.opsForValue().set("faceit:stale:player:p1", "{not json");
        when(delegate.getPlayer("p1")).thenThrow(unavailable);

        assertThatThrownBy(() -> gateway.getPlayer("p1")).isSameAs(unavailable);

        assertThat(output).contains("WARN").contains("faceit:stale:player:p1");
    }

    private FaceitPlayer player() {
        return fixtureAs("faceit/player.json", FaceitPlayer.class);
    }

    private <T> T fixtureAs(String classpathPath, Class<T> type) {
        try {
            return mapper.readValue(fixture(classpathPath), type);
        } catch (JsonProcessingException e) {
            throw new UncheckedIOException("Cannot parse fixture " + classpathPath, e);
        }
    }

    private long ttl(String key) {
        return redis.getExpire(key, TimeUnit.SECONDS);
    }
}
