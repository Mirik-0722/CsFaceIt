package io.csfaceit.backend.auth.dto;

import io.csfaceit.backend.auth.SignedInUser;
import io.csfaceit.backend.usage.UsageService.Allowances;

/**
 * Who is signed in. {@code role} is {@code USER} or {@code ADMIN}: the effective role, the one the settings give the
 * user's SteamID now, which is what decides what the session may do. {@code playerId} is the id the site uses in
 * {@code /players/{playerId}}, the FACEIT player id, and is {@code null} while no FACEIT player is linked; the
 * {@code avatarUrl} and the {@code steamId} are {@code null} when the user has none.
 *
 * <p>{@code limits} is what the user has left of the limits per day: {@code demoUploads}, {@code demoImports} and
 * {@code clipOrders}, each with its {@code limit}, how many are {@code remaining} and when the next place frees
 * ({@code resetsAt}, {@code null} when nothing is counted). It is {@code null} for an administrator, whom no limit
 * applies to.
 */
public record MeResponse(
        long id,
        String nickname,
        String avatarUrl,
        String role,
        String steamId,
        String playerId,
        Allowances limits) {

    public static MeResponse of(SignedInUser user, Allowances limits) {
        return new MeResponse(user.id(), user.nickname(), user.avatarUrl(), user.role().name(), user.steamId(),
                user.playerId(), limits);
    }
}
