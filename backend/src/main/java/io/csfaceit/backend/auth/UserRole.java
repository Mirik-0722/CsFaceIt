package io.csfaceit.backend.auth;

/**
 * What a user may do on the site. An {@code ADMIN} does with a session what the admin key does; a {@code USER} acts for
 * the matches they played and for their own player and clips (see {@code Access}). The role that counts is the
 * effective one, which {@code SessionService#find} works out at every request from {@code auth.admin-steam-ids} and
 * which {@code /api/v1/auth/me} reports; the one stored with the user is what the settings said at the last sign-in.
 */
public enum UserRole {
    USER,
    ADMIN
}
