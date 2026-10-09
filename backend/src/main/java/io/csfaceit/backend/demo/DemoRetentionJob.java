package io.csfaceit.backend.demo;

import io.csfaceit.backend.storage.StorageService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Removes the stored demo files that are older than {@code demo.retention-days} (30 by default; 0 switches the job
 * off), once a day at 04:00 server time ({@code demo.retention-cron} changes the time). The demo files are by far the
 * largest thing the system keeps; the facts the parser extracted from them are small and stay in the database.
 *
 * <p>For each old file the demo's {@code storage_key} is cleared first and the file deleted second. A demo keeps its
 * status, its error and all its parsed facts: only the pointer to the file goes. In this order a failure leaves
 * nothing behind that the next run cannot repair: a file that could not be deleted is listed again and deleted then
 * (the demo no longer points at it), and a file whose demo could not be updated is left alone until the next run. The
 * other order would leave a demo pointing at a file that is gone, which no later run would notice.
 *
 * <p>The storage is listed and deleted from with no transaction open; each update of a demo row is a short
 * transaction of its own ({@link DemoPersistence#clearStorageKey}). One file that cannot be handled is logged and
 * skipped; it never stops the run. A file that a manual upload replaces in the seconds between the listing and its
 * turn is removed with the old one (the upload then has to be repeated); runs are daily and the window is that short.
 */
@Component
public class DemoRetentionJob {

    /** Everything the demo pipeline stores lives under this prefix, see {@code DemoImportWorker.storageKey}. */
    static final String DEMOS_PREFIX = "demos/";

    private static final Logger log = LoggerFactory.getLogger(DemoRetentionJob.class);

    private final StorageService storage;
    private final DemoPersistence persistence;
    private final Clock clock;
    private final int retentionDays;

    public DemoRetentionJob(StorageService storage, DemoPersistence persistence, Clock clock,
                            @Value("${demo.retention-days}") int retentionDays) {
        this.storage = storage;
        this.persistence = persistence;
        this.clock = clock;
        this.retentionDays = retentionDays;
        if (retentionDays <= 0) {
            log.info("Demo retention is off (demo.retention-days={}): stored demo files are kept", retentionDays);
        }
    }

    @Scheduled(cron = "${demo.retention-cron}")
    public void removeExpiredDemoFiles() {
        if (retentionDays <= 0) {
            return;
        }
        Instant cutoff = clock.instant().minus(Duration.ofDays(retentionDays));
        List<String> expired;
        try {
            expired = storage.listOlderThan(DEMOS_PREFIX, cutoff);
        } catch (RuntimeException e) {
            log.error("Demo retention: could not list the stored demo files, trying again at the next run", e);
            return;
        }

        int removed = 0;
        int failed = 0;
        for (String key : expired) {
            try {
                int cleared = persistence.clearStorageKey(key);
                storage.delete(key);
                removed++;
                log.info("Demo retention: removed {} (older than {} days, {} demo(s) forgot it)", key, retentionDays,
                        cleared);
            } catch (RuntimeException e) {
                failed++;
                log.warn("Demo retention: could not remove {}, going on with the others: {}", key, e.toString());
            }
        }
        log.info("Demo retention: {} of {} demo files older than {} days removed, {} failed", removed, expired.size(),
                retentionDays, failed);
    }
}
