package io.csfaceit.backend.analysis;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Binds the {@code analysis.*} block of {@code application.yml}: the thresholds the analysis of a parsed demo works
 * with. Every value is a positive number of seconds, and the application refuses to start without one, so a rule never
 * runs with a threshold of 0.
 *
 * @param clip the seconds a highlight clip keeps before its first and after its last tick
 * @param tradeWindowSeconds how soon after a teammate's death the killer has to be killed for the kill to be a trade
 * @param ninja the thresholds of the ninja defuse
 */
@Validated
@ConfigurationProperties(prefix = "analysis")
public record AnalysisProperties(
        @Valid @NotNull Clip clip,
        @Positive int tradeWindowSeconds,
        @Valid @NotNull Ninja ninja) {

    /** {@code preSeconds} before the first tick of a highlight, {@code postSeconds} after its last. */
    public record Clip(@Positive int preSeconds, @Positive int postSeconds) {
    }

    /** {@code defuseSeconds} is how long a defuse takes in the rules of the ninja defuse. */
    public record Ninja(@Positive int defuseSeconds) {
    }
}
