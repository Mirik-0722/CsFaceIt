package io.csfaceit.backend.auth;

import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserSessionRepository extends JpaRepository<UserSession, String> {

    /**
     * The user a session belongs to, if the session is there and has not ended. One query, so a request with a cookie
     * costs one lookup. {@code playerId} is the FACEIT id the user is linked to ({@code users.faceit_id}, which a link
     * sets together with the player row and an unlink clears with it), so it is {@code null} exactly while no FACEIT
     * player is linked: it is what the rules of {@code Access} take the user's own player from. The role is the stored
     * one; {@code SessionService} replaces it with the effective one.
     */
    @Query("""
            select new io.csfaceit.backend.auth.SignedInUser(u.id, u.nickname, u.avatarUrl, u.role, u.steamId, u.faceitId)
            from UserSession s join s.user u
            where s.tokenHash = :tokenHash and s.expiresAt > :now""")
    Optional<SignedInUser> findSignedInUser(@Param("tokenHash") String tokenHash, @Param("now") Instant now);

    /** Deletes the session; 0 when there is none. The caller is in a transaction. */
    @Modifying
    @Query("delete from UserSession s where s.tokenHash = :tokenHash")
    int deleteByTokenHash(@Param("tokenHash") String tokenHash);

    /** Deletes the sessions that have ended; the caller is in a transaction. */
    @Modifying
    @Query("delete from UserSession s where s.expiresAt <= :now")
    int deleteEndedBefore(@Param("now") Instant now);
}
