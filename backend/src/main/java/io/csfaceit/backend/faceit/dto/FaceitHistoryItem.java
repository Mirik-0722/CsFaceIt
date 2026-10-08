package io.csfaceit.backend.faceit.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import java.util.Map;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public record FaceitHistoryItem(
        String matchId,
        long startedAt,
        long finishedAt,
        Map<String, FaceitHistoryTeam> teams,
        FaceitResults results) {
}
