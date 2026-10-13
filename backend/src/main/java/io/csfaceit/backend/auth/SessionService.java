package io.csfaceit.backend.auth;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Makes, finds and ends the sessions of signed-in users. A session is a random token that only the browser holds, in a
 * cookie; the table keeps the SHA-256 of it. A copy of the table (a backup, a leaked dump) therefore signs nobody in,
 * and signing out is a deleted row, which ends a stolen cookie as well.
 *
 * <p>The token is 32 bytes from {@link SecureRandom}, written as URL-safe Base64 without padding (43 characters), so it
 * needs no escaping in a cookie. It is never logged and never written anywhere but the cookie. Every method is a
 * database step and nothing else: no call to Steam or FACEIT happens in here, let alone inside a transaction.
 */
@Service
public class SessionService {

    /**
     * A session that was just made: the token for the cookie, which is shown once and kept nowhere, and when the
     * session ends. {@link #toString} hides the token.
     */
    public record NewSession(String token, Instant expiresAt) {

        @Override
        public String toString() {
            return "NewSession[token=***, expiresAt=" + expiresAt + "]";
        }
    }

    private static final int TOKEN_BYTES = 32;

    /** A visit is noted when the last one noted is older than this: often enough to know who is around, and no more. */
    private static final Duration SEEN_EVERY = Duration.ofMinutes(15);

    /** What a token looks like: {@link #TOKEN_BYTES} bytes as URL-safe Base64 without padding. */
    private static final Pattern TOKEN_SHAPE = Pattern.compile("[A-Za-z0-9_-]{43}");

    private final SecureRandom random = new SecureRandom();

    private final UserSessionRepository sessions;
    private final UserRepository users;
    private final AuthProperties properties;
    private final Clock clock;

    public SessionService(UserSessionRepository sessions, UserRepository users, AuthProperties properties,
                          Clock clock) {
        this.sessions = sessions;
        this.users = users;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Starts a session for the user. The sessions that have ended are removed in the same step: they are deleted when
     * someone signs in, so no job is needed and the table holds the live sessions and little else.
     */
    @Transactional
    public NewSession create(long userId) {
        byte[] bytes = new byte[TOKEN_BYTES];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);

        Instant now = clock.instant();
        Instant expiresAt = now.plus(properties.sessionLifetime());
        sessions.deleteEndedBefore(now);
        sessions.save(new UserSession(hash(token), users.getReferenceById(userId), now, expiresAt));
        return new NewSession(token, expiresAt);
    }

    /**
     * The user the token belongs to, or empty when it belongs to nobody: it is not a token, it is unknown, or its
     * session has ended. A token that is not worth a lookup (the wrong length or characters) does not reach the
     * database. The caller treats empty as "not signed in", never as an error.
     *
     * <p>The role of the user returned is the <b>effective</b> one: {@code ADMIN} when the SteamID is in
     * {@code auth.admin-steam-ids} now, {@code USER} otherwise, whatever {@code users.role} holds from the last
     * sign-in. A session lasts for weeks and an administrator's cookie does what the admin key does, so a SteamID that
     * is taken off the list is a {@code USER} at the first request after the restart that applied the setting, with
     * the same cookie; and one that is put on the list is an administrator without signing in again.
     */
    @Transactional(readOnly = true)
    public Optional<SignedInUser> find(String token) {
        if (token == null || !TOKEN_SHAPE.matcher(token).matches()) {
            return Optional.empty();
        }
        return sessions.findSignedInUser(hash(token), clock.instant()).map(this::withEffectiveRole);
    }

    private SignedInUser withEffectiveRole(SignedInUser user) {
        UserRole role = user.steamId() != null && properties.adminSteamIds().contains(user.steamId())
                ? UserRole.ADMIN : UserRole.USER;
        return new SignedInUser(user.id(), user.nickname(), user.avatarUrl(), role, user.steamId(), user.playerId());
    }

    /**
     * Notes that the user is using the site now ({@code users.last_seen_at}), which says whose matches are worth
     * fetching. The page asks who is signed in at every load, so the time is written only when none is noted or the
     * one noted is older than {@link #SEEN_EVERY}: one conditional update that mostly changes nothing.
     */
    @Transactional
    public void seen(long userId) {
        Instant now = clock.instant();
        users.markSeen(userId, now, now.minus(SEEN_EVERY));
    }

    /** Ends the session of the token, if there is one: its row is deleted. */
    @Transactional
    public void delete(String token) {
        if (token == null || !TOKEN_SHAPE.matcher(token).matches()) {
            return;
        }
        sessions.deleteByTokenHash(hash(token));
    }

    /** The key of a token in the table: 64 lowercase hex digits. */
    static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            // Every Java runtime has SHA-256.
            throw new IllegalStateException(e);
        }
    }
}
