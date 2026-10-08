package io.csfaceit.backend.faceit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchHistory;
import io.csfaceit.backend.faceit.dto.FaceitMatchStats;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import java.time.Duration;
import java.util.Locale;
import java.util.function.Function;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * Redis read-through cache in front of another {@link FaceitGateway}.
 *
 * <p>Every successful answer is stored twice: under a fresh key with a resource-specific TTL, and under a
 * {@code faceit:stale:} key that lives for {@code staleTtl}. The stale copy is only served when the delegate
 * reports {@link FaceitUnavailableException}. {@link FaceitNotFoundException} is never cached.
 *
 * <p>Redis is best effort: a {@link DataAccessException}, or a cached value that cannot be parsed, is logged at WARN
 * and treated as a cache miss, so the caller always gets what the delegate returns.
 */
public class CachingFaceitGateway implements FaceitGateway {

    private static final Logger log = LoggerFactory.getLogger(CachingFaceitGateway.class);

    private static final String FRESH_PREFIX = "faceit:";
    private static final String STALE_PREFIX = "faceit:stale:";
    private static final String STATUS_FINISHED = "FINISHED";

    private final FaceitGateway delegate;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final FaceitProperties.Cache cache;

    public CachingFaceitGateway(FaceitGateway delegate, StringRedisTemplate redis, ObjectMapper mapper,
                                FaceitProperties properties) {
        this.delegate = delegate;
        this.redis = redis;
        this.mapper = mapper;
        this.cache = properties.cache();
    }

    @Override
    public FaceitPlayer findPlayerByNickname(String nickname) {
        return cached("player-search:" + nickname.toLowerCase(Locale.ROOT), FaceitPlayer.class,
                player -> cache.playerTtl(), () -> delegate.findPlayerByNickname(nickname));
    }

    @Override
    public FaceitPlayer getPlayer(String playerId) {
        return cached("player:" + playerId, FaceitPlayer.class,
                player -> cache.playerTtl(), () -> delegate.getPlayer(playerId));
    }

    @Override
    public FaceitMatchHistory getHistory(String playerId, int offset, int limit) {
        return cached("history:" + playerId + ":" + offset + ":" + limit, FaceitMatchHistory.class,
                history -> cache.historyTtl(), () -> delegate.getHistory(playerId, offset, limit));
    }

    @Override
    public FaceitMatch getMatch(String matchId) {
        return cached("match:" + matchId, FaceitMatch.class,
                match -> STATUS_FINISHED.equals(match.status()) ? cache.matchTtl() : cache.unfinishedMatchTtl(),
                () -> delegate.getMatch(matchId));
    }

    @Override
    public FaceitMatchStats getMatchStats(String matchId) {
        // FACEIT only publishes stats for finished matches, so their existence already means "finished".
        return cached("match-stats:" + matchId, FaceitMatchStats.class,
                stats -> cache.matchTtl(), () -> delegate.getMatchStats(matchId));
    }

    /**
     * Read-through flow shared by every resource: fresh hit, else load and store, else (only when the delegate is
     * unavailable) the stale copy.
     *
     * @param keySuffix identifies the resource; the fresh and stale keys are derived from it
     * @param ttl       fresh TTL, chosen from the loaded value
     */
    private <T> T cached(String keySuffix, Class<T> type, Function<T, Duration> ttl, Supplier<T> loader) {
        String freshKey = FRESH_PREFIX + keySuffix;
        T hit = read(freshKey, type);
        if (hit != null) {
            return hit;
        }

        T loaded;
        try {
            loaded = loader.get();
        } catch (FaceitUnavailableException e) {
            T stale = read(STALE_PREFIX + keySuffix, type);
            if (stale == null) {
                throw e;
            }
            log.warn("FACEIT is unavailable, serving the stale copy of {}", keySuffix);
            return stale;
        }

        if (loaded != null) {
            write(freshKey, STALE_PREFIX + keySuffix, loaded, ttl.apply(loaded));
        }
        return loaded;
    }

    /** The cached value, or {@code null} on a miss, a Redis failure or an unreadable value. */
    private <T> T read(String key, Class<T> type) {
        String json;
        try {
            json = redis.opsForValue().get(key);
        } catch (DataAccessException e) {
            log.warn("Redis read of {} failed, treating it as a cache miss: {}", key, e.getMessage());
            return null;
        }
        if (json == null) {
            return null;
        }
        try {
            return mapper.readValue(json, type);
        } catch (JsonProcessingException e) {
            log.warn("Cached value at {} is unreadable, treating it as a cache miss: {}", key,
                    e.getOriginalMessage());
            return null;
        }
    }

    private void write(String freshKey, String staleKey, Object value, Duration freshTtl) {
        try {
            String json = mapper.writeValueAsString(value);
            redis.opsForValue().set(freshKey, json, freshTtl);
            redis.opsForValue().set(staleKey, json, cache.staleTtl());
        } catch (JsonProcessingException e) {
            log.warn("Cannot serialize the value for {}, skipping the cache write: {}", freshKey,
                    e.getOriginalMessage());
        } catch (DataAccessException e) {
            log.warn("Redis write of {} failed, the value is not cached: {}", freshKey, e.getMessage());
        }
    }
}
