package io.csfaceit.backend.analysis.facts;

/** The two sides of a round. The parser writes them as {@code CT} and {@code T}. */
public enum Side {
    CT,
    T;

    public Side opposite() {
        return this == CT ? T : CT;
    }

    /**
     * The side a database value names. Anything but {@code CT} and {@code T} (including {@code null}) is no side: the
     * analysis treats a value it does not know as absent rather than guessing.
     */
    public static Side fromDatabase(String value) {
        if ("CT".equals(value)) {
            return CT;
        }
        if ("T".equals(value)) {
            return T;
        }
        return null;
    }
}
