package io.csfaceit.backend.faceit.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import java.util.Map;
import java.util.Optional;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public record FaceitPlayer(
        String playerId,
        String nickname,
        String avatar,
        String country,
        Map<String, FaceitGame> games) {

    /** The CS2 section of the profile; empty when the player has never played CS2. */
    public Optional<FaceitGame> cs2() {
        return Optional.ofNullable(games).map(byGame -> byGame.get("cs2"));
    }
}
