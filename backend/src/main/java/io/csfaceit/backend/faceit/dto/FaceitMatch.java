package io.csfaceit.backend.faceit.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import java.util.List;
import java.util.Map;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public record FaceitMatch(
        String matchId,
        String status,
        Long startedAt,
        Long finishedAt,
        Map<String, FaceitMatchTeam> teams,
        FaceitVoting voting,
        FaceitResults results,
        List<String> demoUrl) {
}
