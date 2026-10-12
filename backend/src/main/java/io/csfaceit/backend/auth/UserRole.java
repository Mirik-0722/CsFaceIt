package io.csfaceit.backend.auth;

/**
 * What a user may do on the site. It is stored with the user and reported by {@code /api/v1/auth/me}, but it gives a
 * session no authority yet: the actions of an administrator still take the admin key (see {@code SessionAuthFilter}).
 */
public enum UserRole {
    USER,
    ADMIN
}
