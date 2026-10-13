package io.csfaceit.backend.demo;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Binds the {@code demo.match-check.*} block of {@code application.yml}: how a parsed demo is told from another
 * match's (see {@code analysis/RosterCheck}). {@code minShare} is the share, from 0 to 1, of the roster's players
 * whose SteamID FACEIT gives that has to be among the players of the demo. The application refuses to start without
 * it or with a value outside that range, so that the check never runs with a threshold nobody chose (a missing number
 * would read as 0). 0 lets every demo through, 1 asks for every one of them.
 */
@Validated
@ConfigurationProperties(prefix = "demo.match-check")
public record DemoMatchCheckProperties(@NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double minShare) {
}
