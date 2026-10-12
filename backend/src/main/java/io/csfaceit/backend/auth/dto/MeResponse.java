package io.csfaceit.backend.auth.dto;

import io.csfaceit.backend.auth.SignedInUser;

/**
 * Who is signed in. {@code role} is {@code USER} or {@code ADMIN}. {@code playerId} is the id the site uses in
 * {@code /players/{playerId}}, the FACEIT player id, and is {@code null} while no FACEIT player is linked; the
 * {@code avatarUrl} and the {@code steamId} are {@code null} when the user has none.
 */
public record MeResponse(
        long id,
        String nickname,
        String avatarUrl,
        String role,
        String steamId,
        String playerId) {

    public static MeResponse of(SignedInUser user) {
        return new MeResponse(user.id(), user.nickname(), user.avatarUrl(), user.role().name(), user.steamId(),
                user.playerId());
    }
}
