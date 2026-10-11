package io.csfaceit.backend.analysis.api.dto;

/**
 * One kill of an enemy inside the window of a highlight. {@code weapon} is the raw name from the demo ({@code ak47},
 * {@code knife_t}) and {@code victimNickname} the nickname of the victim as the backend stores it.
 */
public record HighlightKill(int tick, String weapon, boolean headshot, String victimNickname) {
}
