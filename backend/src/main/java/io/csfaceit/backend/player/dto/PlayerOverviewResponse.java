package io.csfaceit.backend.player.dto;

import java.util.List;

/**
 * What the player page shows besides the statistics: the player's results by map and his highlights by type. Both lists
 * are empty for a player the backend knows nothing of. {@code maps} has the map with the most matches first, then
 * by name; {@code highlights} the most frequent type first, then by name.
 */
public record PlayerOverviewResponse(String playerId, List<MapResult> maps, List<HighlightCount> highlights) {
}
