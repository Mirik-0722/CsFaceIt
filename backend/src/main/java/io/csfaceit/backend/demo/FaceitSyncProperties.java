package io.csfaceit.backend.demo;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Binds the {@code faceit.sync.*} block of {@code application.yml}: the automatic bringing of the demos of the
 * matches of the players who use the site ({@link FaceitSyncService}, {@link FaceitSyncJob}).
 *
 * @param enabled false switches the automatic sync off, whatever else is set; it is also off while the site has no
 *        token for FACEIT's Downloads API, because a demo cannot be downloaded without one
 * @param interval how often the job looks for players to sync
 * @param seenWithin only a player who used the site within this long is synced by the job
 * @param maxAge only a match that started within this long is brought
 * @param usersPerRun the most players one run of the job syncs
 * @param matchesPerUser the most imports one sync of a player queues
 * @param matchesPerRun the most imports one run of the job queues in all; the run stops when it is reached. The same
 *        number caps the lost imports one run republishes, and how often that sweep asks FACEIT
 * @param minUserInterval a player is synced at most this often, by the job and by the request alike
 */
@Validated
@ConfigurationProperties(prefix = "faceit.sync")
public record FaceitSyncProperties(
        @DefaultValue("true") boolean enabled,
        @DefaultValue("5m") @NotNull Duration interval,
        @DefaultValue("3d") @NotNull Duration seenWithin,
        @DefaultValue("7d") @NotNull Duration maxAge,
        @DefaultValue("5") @Min(1) int usersPerRun,
        @DefaultValue("3") @Min(1) int matchesPerUser,
        @DefaultValue("10") @Min(1) int matchesPerRun,
        @DefaultValue("10m") @NotNull Duration minUserInterval) {
}
