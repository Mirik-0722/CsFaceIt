package io.csfaceit.backend.cs2;

import io.csfaceit.backend.demo.DemoErrorCode;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.match.MatchSource;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The database side of CS2 matchmaking links: the {@code cs2_links} rows, and the matches the walk along a chain of
 * match sharing codes brings ({@link Cs2ChainJob}). Plain SQL, like the other tables that are written by statements
 * rather than read as objects. No method here does anything but the database, so no network call is ever made with a
 * transaction open.
 *
 * <p>A link's {@code created_at} is the moment it was made, or made again: a new link request replaces the row and its
 * time. The walk writes a link only where that time is still the one it claimed ({@link #update}), so a walk that is
 * running while the player links again, or unlinks, never writes over the new row or brings a deleted one back.
 */
@Component
public class Cs2Links {

    /** The state of a link ({@code cs2_links.state}). */
    public enum State {
        /** The walk goes on. */
        ACTIVE,
        /** Steam refused the authentication code, or it can no longer be opened: the player has to link again. */
        BAD_AUTH_CODE,
        /** Steam said the known code is not one of this player's: the player has to link again. */
        BAD_SHARE_CODE
    }

    /** What the link endpoints show of a link. */
    public record View(State state, Instant linkedAt, Instant checkedAt) {
    }

    /**
     * A link the walk has claimed, with what it needs: the user's SteamID and the sealed authentication code.
     *
     * @param linkedAt {@code created_at} as it was claimed, which the walk's writes are conditional on
     */
    public record Claimed(long userId, String steamId, byte[] authCode, String lastShareCode, String pendingShareCode,
                          int failures, OffsetDateTime linkedAt) {
    }

    /**
     * Where the walk of a link stands, as {@link #update} writes it: every column the walk changes.
     *
     * @param checkedAt the time of Steam's answer in this walk; null keeps the stored one
     */
    public record Progress(State state, String lastShareCode, String pendingShareCode, int failures,
                           Instant nextCheckAt, Instant checkedAt) {
    }

    private static final String FIND_SQL = """
            SELECT state, created_at, checked_at FROM cs2_links WHERE user_id = :userId""";

    /**
     * A new link, or one made again: everything starts over, and the code the player gave is the one whose match is
     * brought first. {@code xmax = 0} tells an inserted row from an updated one.
     */
    private static final String SAVE_SQL = """
            INSERT INTO cs2_links (user_id, auth_code, last_share_code, pending_share_code, state, failures,
                                   next_check_at, checked_at, created_at)
            VALUES (:userId, :authCode, :shareCode, :shareCode, 'ACTIVE', 0, :now, :now, :now)
            ON CONFLICT (user_id) DO UPDATE SET
                auth_code = EXCLUDED.auth_code, last_share_code = EXCLUDED.last_share_code,
                pending_share_code = EXCLUDED.pending_share_code, state = 'ACTIVE', failures = 0,
                next_check_at = EXCLUDED.next_check_at, checked_at = EXCLUDED.checked_at, created_at = EXCLUDED.created_at
            RETURNING (xmax = 0) AS inserted""";

    /**
     * Takes the links that are due, oldest first, and pushes their next look ahead in the same statement, so that no other
     * backend (and no overlapping run) takes them while they are walked. A row another transaction holds is skipped.
     */
    private static final String CLAIM_SQL = """
            WITH due AS (
                SELECT user_id FROM cs2_links
                WHERE state = 'ACTIVE' AND next_check_at <= :now
                ORDER BY next_check_at, user_id
                LIMIT :limit
                FOR UPDATE SKIP LOCKED)
            UPDATE cs2_links l SET next_check_at = :lease
            FROM due, users u
            WHERE l.user_id = due.user_id AND u.id = l.user_id
            RETURNING l.user_id, u.steam_id, l.auth_code, l.last_share_code, l.pending_share_code, l.failures,
                      l.created_at""";

    private static final String UPDATE_SQL = """
            UPDATE cs2_links SET state = :state, last_share_code = :lastShareCode,
                pending_share_code = :pendingShareCode, failures = :failures, next_check_at = :nextCheckAt,
                checked_at = COALESCE(:checkedAt, checked_at)
            WHERE user_id = :userId AND created_at = :linkedAt""";

    /**
     * The matchmaking match of a code the walk found, made if the database does not know it. One that is there keeps
     * its owner; its sharing code and start are filled in when it has none (a match brought by an upload first).
     */
    private static final String MATCH_SQL = """
            INSERT INTO matches (faceit_match_id, source, share_code, owner_user_id, started_at)
            VALUES (:matchId, :source, :shareCode, :ownerUserId, :startedAt)
            ON CONFLICT (faceit_match_id) DO UPDATE SET
                share_code = COALESCE(matches.share_code, EXCLUDED.share_code),
                started_at = COALESCE(matches.started_at, EXCLUDED.started_at)
            WHERE matches.source = EXCLUDED.source""";

    /** The FAILED demo of a match whose replay has expired, unless the match has a demo already. */
    private static final String EXPIRED_DEMO_SQL = """
            INSERT INTO demos (match_id, status, error, error_code, created_at, updated_at)
            SELECT id, :status, :error, :errorCode, :now, :now FROM matches WHERE faceit_match_id = :matchId
            ON CONFLICT (match_id) DO NOTHING""";

    private final JdbcClient jdbc;

    public Cs2Links(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** The user's link, if there is one. */
    @Transactional(readOnly = true)
    public Optional<View> find(long userId) {
        return jdbc.sql(FIND_SQL)
                .param("userId", userId)
                .query((rs, row) -> new View(State.valueOf(rs.getString("state")),
                        instant(rs.getObject("created_at", OffsetDateTime.class)),
                        instant(rs.getObject("checked_at", OffsetDateTime.class))))
                .optional();
    }

    /**
     * Makes the user's link, or makes it again: {@code ACTIVE}, the given code both the known one and the one whose
     * match is brought first, no failures, due now.
     *
     * @return true for a new link, false for one that replaced the user's earlier link
     */
    @Transactional
    public boolean save(long userId, byte[] sealedAuthCode, String shareCode, Instant now) {
        return jdbc.sql(SAVE_SQL)
                .param("userId", userId)
                .param("authCode", sealedAuthCode)
                .param("shareCode", shareCode)
                .param("now", timestamp(now))
                .query(Boolean.class)
                .single();
    }

    /** Deletes the user's link and its code; nothing else (the matches it brought stay). */
    @Transactional
    public void delete(long userId) {
        jdbc.sql("DELETE FROM cs2_links WHERE user_id = :userId").param("userId", userId).update();
    }

    /**
     * Claims at most {@code limit} links that are due ({@code ACTIVE} and {@code next_check_at} not after {@code now}),
     * the longest waiting first, by moving their next look to {@code lease}: until the walk writes their real next look,
     * nobody else takes them, and a walk that dies leaves them to be taken again at {@code lease}.
     */
    @Transactional
    public List<Claimed> claimDue(Instant now, int limit, Instant lease) {
        return jdbc.sql(CLAIM_SQL)
                .param("now", timestamp(now))
                .param("limit", limit)
                .param("lease", timestamp(lease))
                .query((rs, row) -> new Claimed(rs.getLong("user_id"), rs.getString("steam_id"),
                        rs.getBytes("auth_code"), rs.getString("last_share_code"), rs.getString("pending_share_code"),
                        rs.getInt("failures"), rs.getObject("created_at", OffsetDateTime.class)))
                .list();
    }

    /**
     * Writes where the walk of a link stands, if the link is still the one the walk claimed.
     *
     * @return false when the link was made again or deleted meanwhile; nothing is written then, and the walk of this link
     *         has to stop
     */
    @Transactional
    public boolean update(Claimed link, Progress progress) {
        return jdbc.sql(UPDATE_SQL)
                .param("state", progress.state().name())
                .param("lastShareCode", progress.lastShareCode())
                .param("pendingShareCode", progress.pendingShareCode())
                .param("failures", progress.failures())
                .param("nextCheckAt", timestamp(progress.nextCheckAt()))
                .param("checkedAt", timestamp(progress.checkedAt()))
                .param("userId", link.userId())
                .param("linkedAt", link.linkedAt())
                .update() == 1;
    }

    /**
     * Makes the matchmaking match {@code matchId} ({@code mm-<id>}) if the database does not know it: owned by the user of
     * the link, with the sharing code it was found by and the time it was played.
     */
    @Transactional
    public void saveMatch(String matchId, long ownerUserId, String shareCode, Instant startedAt) {
        writeMatch(matchId, ownerUserId, shareCode, startedAt);
    }

    /**
     * Makes the match as {@link #saveMatch} does, and gives it a FAILED demo with {@link DemoErrorCode#REPLAY_EXPIRED}
     * unless it has a demo already (which is left as it is).
     *
     * @return whether the FAILED demo was made
     */
    @Transactional
    public boolean saveExpiredMatch(String matchId, long ownerUserId, String shareCode, Instant startedAt, String error,
                                    Instant now) {
        writeMatch(matchId, ownerUserId, shareCode, startedAt);
        return jdbc.sql(EXPIRED_DEMO_SQL)
                .param("status", DemoStatus.FAILED.name())
                .param("error", error)
                .param("errorCode", DemoErrorCode.REPLAY_EXPIRED.name())
                .param("now", timestamp(now))
                .param("matchId", matchId)
                .update() == 1;
    }

    private void writeMatch(String matchId, long ownerUserId, String shareCode, Instant startedAt) {
        jdbc.sql(MATCH_SQL)
                .param("matchId", matchId)
                .param("source", MatchSource.MATCHMAKING.name())
                .param("shareCode", shareCode)
                .param("ownerUserId", ownerUserId)
                .param("startedAt", timestamp(startedAt))
                .update();
    }

    /** The PostgreSQL driver takes a {@code TIMESTAMPTZ} as an {@link OffsetDateTime}, not as an {@link Instant}. */
    private static OffsetDateTime timestamp(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }

    private static Instant instant(OffsetDateTime timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
