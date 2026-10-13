package io.csfaceit.backend.usage;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Removes the rows of {@code user_actions} that are older than the window of the limits plus a day, once a day at
 * 04:45 server time (after the clean-ups of old demo files and old clips), so that the table does not grow for ever.
 * Only the rows inside the window are ever counted; the extra day keeps the job far away from them, whatever the clocks
 * of the database and the backend say. A run that fails is logged and the next one takes the rows.
 */
@Component
public class UsageCleanupJob {

    private static final Duration MARGIN = Duration.ofDays(1);

    private static final Logger log = LoggerFactory.getLogger(UsageCleanupJob.class);

    private final UsageService usage;
    private final UsageLimits limits;
    private final Clock clock;

    public UsageCleanupJob(UsageService usage, UsageLimits limits, Clock clock) {
        this.usage = usage;
        this.limits = limits;
        this.clock = clock;
    }

    @Scheduled(cron = "0 45 4 * * *")
    public void removeOldActions() {
        Instant cutoff = clock.instant().minus(limits.window()).minus(MARGIN);
        try {
            int removed = usage.deleteOlderThan(cutoff);
            log.info("Usage clean-up: {} counted actions older than {} removed", removed, cutoff);
        } catch (RuntimeException e) {
            log.error("Usage clean-up: could not remove the old counted actions, trying again at the next run", e);
        }
    }
}
