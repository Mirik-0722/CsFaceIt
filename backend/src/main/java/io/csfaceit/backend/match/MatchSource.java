package io.csfaceit.backend.match;

/**
 * Where a match comes from ({@code matches.source}).
 *
 * <ul>
 *   <li>{@link #FACEIT}: a FACEIT match, whose public id is FACEIT's own ({@code 1-<uuid>}). FACEIT is asked for its
 *       details, roster and statistics.
 *   <li>{@link #MATCHMAKING}: a Valve matchmaking match (Premier, Competitive, Wingman), whose public id is
 *       {@code mm-<Valve match id>}. FACEIT knows nothing of it and is never asked: the match exists from its demo alone
 *       (see {@link DemoScoreboard}).
 * </ul>
 *
 * <p>The public id tells the two apart before anything is read: a FACEIT id never starts with {@value #MATCHMAKING_PREFIX},
 * so a request for an {@code mm-} match can be kept away from FACEIT even when the database does not know the match.
 */
public enum MatchSource {
    FACEIT,
    MATCHMAKING;

    /** The start of the public id of every matchmaking match. */
    public static final String MATCHMAKING_PREFIX = "mm-";

    /** The source a public match id stands for. */
    public static MatchSource ofMatchId(String matchId) {
        return matchId != null && matchId.startsWith(MATCHMAKING_PREFIX) ? MATCHMAKING : FACEIT;
    }

    /** Whether the public match id is a matchmaking match's, which FACEIT must not be asked about. */
    public static boolean isMatchmaking(String matchId) {
        return ofMatchId(matchId) == MATCHMAKING;
    }
}
