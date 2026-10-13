package io.csfaceit.backend.auth;

import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, Long> {

    /** At most one row has a given SteamID: {@code users.steam_id} is unique. */
    Optional<User> findBySteamId(String steamId);

    /** At most one row has a given FACEIT id: {@code users.faceit_id} is unique. */
    Optional<User> findByFaceitId(String faceitId);

    /**
     * Notes that the user was seen at {@code now}, unless a visit after {@code staleBefore} is noted already. One
     * statement on the column alone, which the entity does not map: saving a {@link User} never writes it back.
     *
     * @return 1 when the time was written, 0 when the one that stands is recent enough (or the user is gone)
     */
    @Modifying
    @Query(value = "UPDATE users SET last_seen_at = :now WHERE id = :id "
            + "AND (last_seen_at IS NULL OR last_seen_at < :staleBefore)", nativeQuery = true)
    int markSeen(@Param("id") long id, @Param("now") Instant now, @Param("staleBefore") Instant staleBefore);
}
