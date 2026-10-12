package io.csfaceit.backend.clip.worker.dto;

/** The longest values a recorder may send for what is stored about it: the widths of the columns they end up in. */
public final class WorkerLimits {

    /** The name of a recorder: {@code clips.claimed_by} and {@code clip_workers.name}. */
    public static final int NAME = 64;

    /** The version of a recorder: {@code clip_workers.version}. */
    public static final int VERSION = 32;

    /** The mode of a recorder: {@code clip_workers.mode}. */
    public static final int MODE = 16;

    private WorkerLimits() {
    }
}
