package io.csfaceit.backend.match;

import java.util.Optional;

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

    /**
     * The public id of the matchmaking match whose Valve match id is {@code digits}: {@code mm-} and the id in decimal,
     * without the zeros Valve pads it with in a file name. Valve's match id is an unsigned 64-bit number, so after the
     * zeros it is 1 to 20 digits, not 0, and at most 2^64 - 1; anything else names no match. This is the one rule for
     * such ids: every place that turns a Valve match id into a match of this site goes through it.
     *
     * @param digits the match id as Valve writes it, decimal digits only, possibly zero-padded
     * @return {@code mm-<id>}, or empty when {@code digits} is not a Valve match id
     */
    public static Optional<String> matchmakingId(String digits) {
        if (digits == null || digits.isEmpty() || !digits.chars().allMatch(c -> c >= '0' && c <= '9')) {
            return Optional.empty();
        }
        int start = 0;
        while (start < digits.length() && digits.charAt(start) == '0') {
            start++;
        }
        String id = digits.substring(start);
        if (id.isEmpty() || id.length() > 20) {
            return Optional.empty();
        }
        try {
            Long.parseUnsignedLong(id);
        } catch (NumberFormatException e) {
            return Optional.empty();
        }
        return Optional.of(MATCHMAKING_PREFIX + id);
    }
}
