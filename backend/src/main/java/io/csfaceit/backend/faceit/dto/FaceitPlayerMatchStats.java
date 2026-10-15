package io.csfaceit.backend.faceit.dto;

import java.util.List;

/**
 * A player's own numbers in each of a run of his CS2 matches, newest first, as FACEIT's per-player statistics list them
 * ({@code GET /players/{id}/games/cs2/stats}). A value FACEIT did not give, or gave in a form that is not a number, is
 * {@code null}; {@code map} is FACEIT's name of the map ({@code de_mirage}), the form the database stores.
 */
public record FaceitPlayerMatchStats(List<Match> matches) {

    public FaceitPlayerMatchStats {
        matches = matches == null ? List.of() : List.copyOf(matches);
    }

    public record Match(String matchId, String map, Integer kills, Integer deaths, Integer assists, Double adr) {
    }
}
