package io.csfaceit.backend.demo.dto;

import io.csfaceit.backend.demo.DemoStatus;
import java.time.Instant;

/**
 * The state of a match's demo. {@code matchId} is the FACEIT match id; {@code error} is set while the demo is FAILED,
 * and while it is PARSED after an analysis that failed.
 */
public record DemoResponse(long demoId, String matchId, DemoStatus status, String error, Instant updatedAt) {
}
