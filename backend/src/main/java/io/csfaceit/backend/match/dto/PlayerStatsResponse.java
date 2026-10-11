package io.csfaceit.backend.match.dto;

public record PlayerStatsResponse(
        String playerId,
        String nickname,
        int kills,
        int deaths,
        int assists,
        int headshots,
        double kdRatio,
        double krRatio,
        double adr) {
}
