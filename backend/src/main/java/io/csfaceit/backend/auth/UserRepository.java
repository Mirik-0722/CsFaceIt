package io.csfaceit.backend.auth;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

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

    /** A user whose matches are due to be fetched from FACEIT: the row and the FACEIT player it is linked to. */
    interface SyncCandidate {
        long getId();

        String getFaceitId();
    }

    /**
     * The users the automatic sync of FACEIT demos is due for: linked to a FACEIT player, seen after
     * {@code seenAfter}, and never synced or synced before {@code syncedBefore}; the one synced longest ago first.
     * Native, like {@link #markSeen}, because the two columns are not mapped by the entity.
     */
    @Query(value = "SELECT id AS id, faceit_id AS faceitId FROM users WHERE faceit_id IS NOT NULL "
            + "AND last_seen_at > :seenAfter AND (faceit_synced_at IS NULL OR faceit_synced_at < :syncedBefore) "
            + "ORDER BY faceit_synced_at ASC NULLS FIRST, id LIMIT :limit", nativeQuery = true)
    List<SyncCandidate> findDueForSync(@Param("seenAfter") Instant seenAfter,
                                       @Param("syncedBefore") Instant syncedBefore, @Param("limit") int limit);

    /** Whether the user was never synced or was synced before {@code syncedBefore}. */
    @Query(value = "SELECT count(*) FROM users WHERE id = :id "
            + "AND (faceit_synced_at IS NULL OR faceit_synced_at < :syncedBefore)", nativeQuery = true)
    int countDueForSync(@Param("id") long id, @Param("syncedBefore") Instant syncedBefore);

    /** Notes that the user's matches were fetched from FACEIT at {@code now}. */
    @Transactional
    @Modifying
    @Query(value = "UPDATE users SET faceit_synced_at = :now WHERE id = :id", nativeQuery = true)
    int markSynced(@Param("id") long id, @Param("now") Instant now);
}
