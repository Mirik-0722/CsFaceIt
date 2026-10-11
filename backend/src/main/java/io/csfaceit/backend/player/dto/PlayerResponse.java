package io.csfaceit.backend.player.dto;

/** A player's public profile; {@code elo} and {@code level} are {@code null} when the player has never played CS2. */
public record PlayerResponse(
        String playerId,
        String nickname,
        String avatar,
        String country,
        Integer elo,
        Integer level) {
}
