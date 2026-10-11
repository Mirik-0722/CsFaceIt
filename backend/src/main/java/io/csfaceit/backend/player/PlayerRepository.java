package io.csfaceit.backend.player;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PlayerRepository extends JpaRepository<Player, Long> {

    Optional<Player> findByFaceitId(String faceitId);

    /** At most one row has a given SteamID: {@code uq_players_steam_id} is a unique index. */
    Optional<Player> findBySteamId(String steamId);
}
