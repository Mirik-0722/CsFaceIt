package io.csfaceit.backend.player.dto;

import java.util.List;

/** A page of a player's match history; {@code offset} and {@code limit} echo the request. */
public record MatchHistoryResponse(List<MatchSummary> items, int offset, int limit) {
}
