package io.csfaceit.backend.demo.dto;

import io.csfaceit.backend.demo.DemoErrorCode;
import io.csfaceit.backend.demo.DemoStatus;
import java.time.Instant;

/**
 * The state of a match's demo. {@code matchId} is the FACEIT match id; {@code error} is set while the demo is FAILED,
 * and while it is PARSED after an analysis that failed; it is an English sentence for the logs and for a client that has
 * nothing better. {@code errorCode} is the same reason as a code a page can translate, and is null for every failure
 * that has none (see {@link DemoErrorCode}).
 */
public record DemoResponse(long demoId, String matchId, DemoStatus status, String error, DemoErrorCode errorCode,
                           Instant updatedAt) {
}
