package io.csfaceit.backend.auth;

/**
 * Who is making a request that changes something, as the rules of {@link Access} need to know it.
 *
 * <ul>
 *   <li>{@link Kind#KEY}: the request carried the admin key ({@code X-API-Key}). The key wins when a session cookie
 *       comes with it, so {@code user} is {@code null}: what the key does is done by nobody in particular.
 *   <li>{@link Kind#SYSTEM}: the site itself, for what it does without a request ({@link #system()}); like the key it
 *       has no user, and no request can become it.
 *   <li>{@link Kind#ADMIN}: a session whose SteamID is in {@code auth.admin-steam-ids} now.
 *   <li>{@link Kind#USER}: any other session.
 * </ul>
 *
 * @param user the signed-in user of a session; {@code null} for the key and the system
 */
public record Actor(Kind kind, SignedInUser user) {

    public enum Kind {
        KEY,
        /** The site itself, see {@link Actor#system()}. */
        SYSTEM,
        ADMIN,
        USER
    }

    public Actor {
        if (kind == null || (kind == Kind.KEY || kind == Kind.SYSTEM) != (user == null)) {
            throw new IllegalArgumentException("A session has a user and the admin key and the system have none");
        }
    }

    /**
     * The actor of what the site does by itself (the automatic sync of FACEIT demos): no request, no credential and no
     * user, so no limit per day, and it passes the rules of {@link Access} like the key. It does not depend on the admin
     * key's value.
     */
    public static Actor system() {
        return new Actor(Kind.SYSTEM, null);
    }

    /** The actor of a request that carried the admin key. */
    public static Actor key() {
        return new Actor(Kind.KEY, null);
    }

    /** The actor of a session: an administrator when the user's role, which is the effective one, says so. */
    public static Actor of(SignedInUser user) {
        return new Actor(user.role() == UserRole.ADMIN ? Kind.ADMIN : Kind.USER, user);
    }

    /** The id of the user who acts, to record who did something; {@code null} for the key and the system. */
    public Long userId() {
        return user == null ? null : user.id();
    }

    /** Whether no limit per day applies: true for the key, the system and an administrator. */
    public boolean unlimited() {
        return kind != Kind.USER;
    }
}
