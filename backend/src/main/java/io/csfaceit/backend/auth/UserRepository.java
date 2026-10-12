package io.csfaceit.backend.auth;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, Long> {

    /** At most one row has a given SteamID: {@code users.steam_id} is unique. */
    Optional<User> findBySteamId(String steamId);

    /** At most one row has a given FACEIT id: {@code users.faceit_id} is unique. */
    Optional<User> findByFaceitId(String faceitId);
}
