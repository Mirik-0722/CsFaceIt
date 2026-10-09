package io.csfaceit.backend.match.dto;

import java.util.List;

public record TeamStatsResponse(String teamId, String name, int score, boolean win,
                                List<PlayerStatsResponse> players) {
}
