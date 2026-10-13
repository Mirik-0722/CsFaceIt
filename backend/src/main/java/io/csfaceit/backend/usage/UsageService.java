package io.csfaceit.backend.usage;

import io.csfaceit.backend.auth.Actor;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.EnumMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Counts what a signed-in player does against the limits per day ({@link UsageLimits}): demo uploads, demo imports and
 * clip orders, each within a rolling window that ends now. One row of {@code user_actions} is one thing that was
 * started; a limit is "so many rows of a kind within the window". The admin key and an administrator
 * ({@link Actor#unlimited}) are never counted and never refused.
 *
 * <p>A caller takes a place before the effect ({@link #reserve}) and gives it back when the effect did not happen
 * ({@link #release}), so that a refused request leaves no counted row and a counted row stands for something that was
 * started. {@code reserve} joins the transaction of its caller when there is one: called inside the transaction that
 * queues a clip or a demo, the place and the queued row are written together or not at all, and nothing has to be given
 * back when that transaction fails.
 *
 * <p>The table has no entity: its rows are counted, inserted and deleted and never read as objects, so the three
 * statements are plain SQL.
 */
@Service
public class UsageService {

    /** A place taken by {@link #reserve}; {@code actionId} is {@code null} when nothing was counted (no limit applies). */
    public record Reservation(Long actionId) {

        static final Reservation UNCOUNTED = new Reservation(null);
    }

    /**
     * What a user has left of one kind.
     *
     * @param limit how many the window allows
     * @param remaining how many of them are left now; never negative
     * @param resetsAt when the next place frees, which is when the oldest counted action leaves the window (or, with
     *        more counted than a lowered limit allows, the one whose leaving brings the count below the limit);
     *        {@code null} when nothing is counted
     */
    public record Allowance(int limit, int remaining, Instant resetsAt) {
    }

    /** What a user has left of each kind, as {@code /api/v1/auth/me} shows it. */
    public record Allowances(Allowance demoUploads, Allowance demoImports, Allowance clipOrders) {
    }

    /** What is counted of one kind within the window: how many rows, and when the oldest of them was written. */
    private record Counted(int count, Instant oldest) {

        static final Counted NOTHING = new Counted(0, null);
    }

    private static final Logger log = LoggerFactory.getLogger(UsageService.class);

    private final JdbcTemplate jdbc;
    private final UsageLimits limits;
    private final Clock clock;

    public UsageService(JdbcTemplate jdbc, UsageLimits limits, Clock clock) {
        this.jdbc = jdbc;
        this.limits = limits;
        this.clock = clock;
    }

    /**
     * Takes one place of the kind for the actor, or refuses. The user's row is locked first, so two requests of one
     * user are counted one after the other and can never both take the last place; the lock is held until the
     * transaction ends, which is this method's own or the caller's. The lock is {@code FOR NO KEY UPDATE}: it excludes
     * another request that counts, and does not make a row that only refers to the user (a new session, a clip) wait.
     *
     * @return the place, to give back with {@link #release} if nothing is started after all
     * @throws QuotaExceededException the user has as many of the kind within the window as the limit allows; nothing
     *         is written
     */
    @Transactional
    public Reservation reserve(Actor actor, UsageKind kind) {
        if (actor.unlimited()) {
            return Reservation.UNCOUNTED;
        }
        long userId = actor.userId();
        jdbc.queryForList("SELECT id FROM users WHERE id = ? FOR NO KEY UPDATE", Long.class, userId);

        // Read after the lock: the time spent waiting for another request of the user is not part of the window.
        Instant now = clock.instant();
        Counted counted = jdbc.query(
                "SELECT count(*), min(created_at) FROM user_actions WHERE user_id = ? AND kind = ? AND created_at > ?",
                rs -> rs.next() ? new Counted(rs.getInt(1), instant(rs.getObject(2, OffsetDateTime.class)))
                        : Counted.NOTHING,
                userId, kind.name(), timestamp(now.minus(limits.window())));
        int limit = limits.of(kind);
        if (counted.count() >= limit) {
            Instant retryAt = nextPlaceFrees(userId, kind, now, counted, limit);
            Duration retryAfter = Duration.between(now, retryAt);
            // Not every refusal here is a 429: a caller may answer with what stands instead (the clip or the demo that
            // a concurrent request of the user just queued), so this is no line for the log of a normal day.
            log.debug("No place for user {}: {} ({} of {} in the window)", userId, kind.limitCode(), counted.count(),
                    limit);
            throw new QuotaExceededException(kind, limit, limits.window(), retryAt,
                    retryAfter.isNegative() ? Duration.ZERO : retryAfter);
        }
        Long actionId = jdbc.queryForObject(
                "INSERT INTO user_actions (user_id, kind, created_at) VALUES (?, ?, ?) RETURNING id",
                Long.class, userId, kind.name(), timestamp(now));
        return new Reservation(actionId);
    }

    /**
     * Gives a place back: nothing was started for it. It never throws, because it is called on the way out of a
     * request that has already failed and whose failure is the answer; a place that cannot be given back stays counted
     * until it leaves the window, which is a warning. It is one statement and opens no transaction of its own, so
     * that a database that cannot be reached is caught here too.
     */
    public void release(Reservation reservation) {
        if (reservation == null || reservation.actionId() == null) {
            return;
        }
        try {
            jdbc.update("DELETE FROM user_actions WHERE id = ?", reservation.actionId());
        } catch (RuntimeException e) {
            log.warn("Could not give back the counted action {}; it stays counted until it leaves the window: {}",
                    reservation.actionId(), e.toString());
        }
    }

    /** What the user has left of each kind now. Reads only, and takes no lock. */
    @Transactional(readOnly = true)
    public Allowances allowances(long userId) {
        Map<UsageKind, Counted> counted = new EnumMap<>(UsageKind.class);
        Instant now = clock.instant();
        jdbc.query(
                "SELECT kind, count(*), min(created_at) FROM user_actions WHERE user_id = ? AND created_at > ? "
                        + "GROUP BY kind",
                rs -> {
                    UsageKind kind = kindOf(rs.getString(1));
                    if (kind != null) {
                        counted.put(kind, new Counted(rs.getInt(2), instant(rs.getObject(3, OffsetDateTime.class))));
                    }
                },
                userId, timestamp(now.minus(limits.window())));
        return new Allowances(
                allowance(userId, UsageKind.DEMO_UPLOAD, now, counted),
                allowance(userId, UsageKind.DEMO_IMPORT, now, counted),
                allowance(userId, UsageKind.CLIP_ORDER, now, counted));
    }

    /**
     * Deletes the rows that no limit counts any more.
     *
     * @return how many rows went
     */
    @Transactional
    public int deleteOlderThan(Instant cutoff) {
        return jdbc.update("DELETE FROM user_actions WHERE created_at < ?", timestamp(cutoff));
    }

    private Allowance allowance(long userId, UsageKind kind, Instant now, Map<UsageKind, Counted> counted) {
        Counted of = counted.getOrDefault(kind, Counted.NOTHING);
        int limit = limits.of(kind);
        return new Allowance(limit, Math.max(0, limit - of.count()),
                of.oldest() == null ? null : nextPlaceFrees(userId, kind, now, of, limit));
    }

    /**
     * When the next place of the kind frees. Normally that is when the oldest counted action leaves the window. With
     * more counted than the limit allows (the limit was lowered while they stood) the oldest leaving frees nothing
     * yet: a place frees when the count falls below the limit, which is when the (count - limit + 1)-th oldest
     * leaves. That one is read only then.
     */
    private Instant nextPlaceFrees(long userId, UsageKind kind, Instant now, Counted counted, int limit) {
        Instant leaving = counted.oldest();
        if (counted.count() > limit) {
            leaving = jdbc.query(
                    "SELECT created_at FROM user_actions WHERE user_id = ? AND kind = ? AND created_at > ? "
                            + "ORDER BY created_at, id OFFSET ? LIMIT 1",
                    rs -> rs.next() ? instant(rs.getObject(1, OffsetDateTime.class)) : counted.oldest(),
                    userId, kind.name(), timestamp(now.minus(limits.window())), counted.count() - limit);
        }
        return leaving.plus(limits.window());
    }

    /** A row of a kind this version does not know (written by a later one) is counted for nothing. */
    private static UsageKind kindOf(String name) {
        try {
            return UsageKind.valueOf(name);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** The PostgreSQL driver takes a {@code TIMESTAMPTZ} as an {@link OffsetDateTime}, not as an {@link Instant}. */
    private static OffsetDateTime timestamp(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private static Instant instant(OffsetDateTime timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
