package io.csfaceit.backend.auth;

/**
 * Who a session belongs to, as the request needs to know it: the principal that {@link SessionAuthFilter} puts in the
 * security context and what {@code /api/v1/auth/me} answers with. It is a snapshot taken when the request arrived.
 *
 * @param playerId the id of the user's FACEIT player, the one the site uses in {@code /players/{playerId}}; {@code null}
 *        while no FACEIT player is linked
 */
public record SignedInUser(
        long id,
        String nickname,
        String avatarUrl,
        UserRole role,
        String steamId,
        String playerId) {
}
