package io.csfaceit.backend.analysis.api.dto;

import java.util.List;

/** A page of a player's highlights, newest match first; {@code offset} and {@code limit} echo the request. */
public record HighlightPageResponse(List<HighlightResponse> items, int offset, int limit) {
}
