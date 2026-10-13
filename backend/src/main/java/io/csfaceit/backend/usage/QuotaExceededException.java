package io.csfaceit.backend.usage;

import java.time.Duration;
import java.time.Instant;

/**
 * A signed-in player has done as much of one kind as the limit per day allows. The answer is 429 with the kind's code
 * ({@link UsageKind#limitCode}), {@code retryAt} in the body and a {@code Retry-After} header. Nothing was counted
 * for the request that was refused.
 */
public class QuotaExceededException extends RuntimeException {

    private final UsageKind kind;
    private final Instant retryAt;
    private final Duration retryAfter;

    /**
     * @param retryAt when the next place frees: the oldest counted action leaves the window
     * @param retryAfter how long that is from the moment of the refusal; never negative
     */
    public QuotaExceededException(UsageKind kind, int limit, Duration window, Instant retryAt, Duration retryAfter) {
        super("The limit of " + limit + " " + kind.plural() + " in " + inWords(window)
                + " is reached; the next one is possible at " + retryAt);
        this.kind = kind;
        this.retryAt = retryAt;
        this.retryAfter = retryAfter;
    }

    public UsageKind getKind() {
        return kind;
    }

    public Instant getRetryAt() {
        return retryAt;
    }

    public Duration getRetryAfter() {
        return retryAfter;
    }

    /** "24 hours" for a window of whole hours, and the ISO-8601 form ("PT90M") for any other. */
    private static String inWords(Duration window) {
        if (!window.isZero() && window.equals(Duration.ofHours(window.toHours()))) {
            return window.toHours() == 1 ? "1 hour" : window.toHours() + " hours";
        }
        return window.toString();
    }
}
