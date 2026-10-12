package io.csfaceit.backend.clip.worker.dto;

/**
 * What a recorder may send as its name, version and mode: how long they may be (the widths of the columns they end up
 * in) and what they are made of. They are plain words, because they end up in log lines and in the database, and a
 * line break in a name would forge a line of the log and a NUL character is refused by PostgreSQL.
 */
public final class WorkerLimits {

    /** The name of a recorder: {@code clips.claimed_by} and {@code clip_workers.name}. */
    public static final int NAME = 64;

    /** The version of a recorder: {@code clip_workers.version}. */
    public static final int VERSION = 32;

    /** The mode of a recorder: {@code clip_workers.mode}. */
    public static final int MODE = 16;

    /** The characters of a name, a version or a mode: letters, digits, {@code .}, {@code _} and {@code -}. */
    public static final String PLAIN = "[A-Za-z0-9._-]*";

    /** What is said of a value that is not made of those. */
    public static final String PLAIN_MESSAGE = "may contain only letters, digits, '.', '_' and '-'";

    private WorkerLimits() {
    }
}
