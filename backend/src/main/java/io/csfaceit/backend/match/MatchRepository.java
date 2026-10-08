package io.csfaceit.backend.match;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MatchRepository extends JpaRepository<Match, Long> {

    Optional<Match> findByFaceitMatchId(String faceitMatchId);
}
