package io.csfaceit.backend.player.dto;

import java.util.List;

/**
 * A page of a player's match history with what the backend knows of each match; {@code offset} and {@code limit} echo
 * the request.
 */
public record PlayerMatchListResponse(List<PlayerMatchResponse> items, int offset, int limit) {
}
