package io.csfaceit.backend.match.dto;

import java.util.List;

/** One side of a match; {@code factionId} is FACEIT's faction key ({@code faction1} or {@code faction2}). */
public record TeamResponse(String factionId, String name, List<RosterPlayerResponse> players) {
}
