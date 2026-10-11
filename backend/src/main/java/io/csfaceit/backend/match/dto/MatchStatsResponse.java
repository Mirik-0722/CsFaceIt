package io.csfaceit.backend.match.dto;

import java.util.List;

public record MatchStatsResponse(String matchId, String mapName, int rounds, List<TeamStatsResponse> teams) {
}
