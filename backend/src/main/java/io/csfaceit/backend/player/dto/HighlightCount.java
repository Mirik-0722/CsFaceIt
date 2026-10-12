package io.csfaceit.backend.player.dto;

/** How many highlights of one type there are; {@code type} is the name of a highlight type, such as {@code K3}. */
public record HighlightCount(String type, int count) {
}
