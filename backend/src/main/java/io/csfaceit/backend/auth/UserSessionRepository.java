package io.csfaceit.backend.auth;

import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserSessionRepository extends JpaRepository<UserSession, String> {

    /**
     * The user a session belongs to, if the session is there and has not ended. One query: the user and the FACEIT id of
     * their player row are read together, so a request with a cookie costs one lookup. The player is the one the user
     * is linked to ({@code player_id}), so {@code playerId} is {@code null} exactly while no player is linked.
     */
    @Query("""
            select new io.csfaceit.backend.auth.SignedInUser(u.id, u.nickname, u.avatarUrl, u.role, u.steamId, p.faceitId)
            from UserSession s join s.user u left join u.player p
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
