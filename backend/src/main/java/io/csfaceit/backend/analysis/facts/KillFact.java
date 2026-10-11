package io.csfaceit.backend.analysis.facts;

/**
 * One row of {@code kills}. Every id is a {@code players.id}. {@code killerId} is {@code null} when the world or the
 * bomb killed the victim; a team kill and a kill of oneself are rows like any other, and it is the analysis that
 * decides what they count as (see {@link RoundFacts#enemies}). The sides are the ones at the tick of the kill and
 * are {@code null} when the parser did not know them.
 */
public record KillFact(
        int tick,
        Long killerId,
        long victimId,
        Long assisterId,
        String weapon,
        boolean headshot,
        boolean wallbang,
        boolean noscope,
        boolean thrusmoke,
        Side killerSide,
        Side victimSide) {
}
