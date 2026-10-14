package io.csfaceit.backend.demo;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs {@link FaceitSyncService#runOnce} every {@code faceit.sync.interval}, counted from the end of the last run, so
 * that runs never overlap in one process. The first run is one interval after the start: the site has not been used
 * since it came up, and the broker and FACEIT are given time to be reachable. A run that fails is logged and the next
 * one goes on as usual.
 */
@Component
public class FaceitSyncJob {

    private static final Logger log = LoggerFactory.getLogger(FaceitSyncJob.class);

    private final FaceitSyncService sync;

    public FaceitSyncJob(FaceitSyncService sync) {
        this.sync = sync;
    }

    @Scheduled(fixedDelayString = "${faceit.sync.interval:5m}", initialDelayString = "${faceit.sync.interval:5m}")
    public void run() {
        try {
            sync.runOnce();
        } catch (RuntimeException e) {
            log.warn("FACEIT sync: the run failed, trying again at the next one", e);
        }
    }
}
