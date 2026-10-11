package io.csfaceit.backend.analysis.facts;

/**
 * One row of {@code damages}. {@code attackerId} and {@code victimId} are {@code players.id}; the attacker is
 * {@code null} for damage the world caused. {@code damageHealth} is the raw damage of the hit, which can be more than
 * the health the victim had left (an AWP headshot is over 400).
 */
public record DamageFact(int tick, Long attackerId, long victimId, int damageHealth) {
}
