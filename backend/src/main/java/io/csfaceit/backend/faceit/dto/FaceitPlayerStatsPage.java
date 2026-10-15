package io.csfaceit.backend.faceit.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * The answer of {@code GET /players/{id}/games/cs2/stats}: one item per match, each a flat object from FACEIT's names
 * ({@code "Match Id"}, {@code "Map"}, {@code "Kills"}, {@code "ADR"}, ...) to values. The values are strings except a
 * few numbers such as {@code "Match Finished At"}, hence {@code Object}.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record FaceitPlayerStatsPage(List<Item> items) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Item(Map<String, Object> stats) {
    }

    /** The numbers this site reads of each match; an item without a match id is left out. */
    public FaceitPlayerMatchStats matchStats() {
        if (items == null) {
            return new FaceitPlayerMatchStats(List.of());
        }
        return new FaceitPlayerMatchStats(items.stream()
                .filter(Objects::nonNull)
                .map(Item::stats)
                .filter(stats -> stats != null && text(stats, "Match Id") != null)
                .map(stats -> new FaceitPlayerMatchStats.Match(text(stats, "Match Id"), text(stats, "Map"),
                        integer(stats, "Kills"), integer(stats, "Deaths"), integer(stats, "Assists"),
                        decimal(stats, "ADR")))
                .toList());
    }

    private static String text(Map<String, Object> stats, String name) {
        Object value = stats.get(name);
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? null : text;
    }

    private static Integer integer(Map<String, Object> stats, String name) {
        String text = text(stats, name);
        try {
            return text == null ? null : Integer.valueOf(text);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Double decimal(Map<String, Object> stats, String name) {
        String text = text(stats, name);
        try {
            Double value = text == null ? null : Double.valueOf(text);
            return value == null || !Double.isFinite(value) ? null : value;
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
