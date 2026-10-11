package io.csfaceit.backend.demo;

/** Where a demo is in the import and parse pipeline; see {@link Demo#transitionTo} for the allowed moves. */
public enum DemoStatus {
    QUEUED,
    STORED,
    PARSED,
    ANALYZED,
    FAILED
}
