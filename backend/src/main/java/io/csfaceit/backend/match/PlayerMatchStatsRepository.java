package io.csfaceit.backend.match;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PlayerMatchStatsRepository extends JpaRepository<PlayerMatchStats, Long> {

    Optional<PlayerMatchStats> findByPlayerIdAndMatchId(Long playerId, Long matchId);
}
