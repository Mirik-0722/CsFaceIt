package io.csfaceit.backend.clip;

import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.storage.StorageException;
import io.csfaceit.backend.storage.StorageService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Removes the clips that finished more than {@code clip.retention-days} ago (30 by default; 0 switches the job off),
 * once a day at 04:30 server time ({@code clip.retention-cron} changes the time). It takes the {@code DONE} clips and
 * the {@code FAILED} ones, both have a {@code finished_at}, and deletes each of them the way a delete request does
 * ({@link ClipService#delete}): the row, then the files of every attempt. A clip that is not finished is never
 * touched, so the job cannot take a clip from a recorder: no request of a recorder moves a finished clip any more.
 *
 * <p>The clips are looked for with no transaction open and each is deleted on its own; one that cannot be deleted is
 * logged and skipped, it never stops the run, and is found again at the next one. The file of a clip that was deleted
 * but could not be removed from the storage stays there (a warning in the log at the time), since the row that named it
 * is gone. A clip that someone deleted between the look and its turn is not a failure.
 *
 * <p>A run does not start while the storage cannot be asked. The row goes first and nothing sweeps {@code clips/} for
 * files that no row names, so with the storage down at the hour of the run every expired clip would lose its row and
 * keep its files for good. Before the loop the job therefore puts one question to the storage that costs next to
 * nothing (whether a key exists, to which no is as good an answer as yes); if the storage fails to answer, the whole
 * run is skipped with a warning, the rows stay, and the next run takes the clips.
 */
@Component
public class ClipRetentionJob {

    /** What the storage is asked about before a run. Nothing is stored under it: only a failure to answer matters. */
    private static final String PROBE_KEY = "clips/.retention-probe";

    private static final Logger log = LoggerFactory.getLogger(ClipRetentionJob.class);

    private final ClipPersistence persistence;
    private final ClipService clips;
    private final StorageService storage;
    private final ClipProperties properties;
    private final Clock clock;

    public ClipRetentionJob(ClipPersistence persistence, ClipService clips, StorageService storage,
                            ClipProperties properties, Clock clock) {
        this.persistence = persistence;
        this.clips = clips;
        this.storage = storage;
        this.properties = properties;
        this.clock = clock;
        if (properties.retentionDays() <= 0) {
            log.info("Clip retention is off (clip.retention-days={}): clips are kept", properties.retentionDays());
        }
    }

    @Scheduled(cron = "${clip.retention-cron}")
    public void removeExpiredClips() {
        int retentionDays = properties.retentionDays();
        if (retentionDays <= 0) {
            return;
        }
        Instant cutoff = clock.instant().minus(Duration.ofDays(retentionDays));
        List<Long> expired;
        try {
            expired = persistence.findFinishedBefore(cutoff);
        } catch (RuntimeException e) {
            log.error("Clip retention: could not look for the expired clips, trying again at the next run", e);
            return;
        }
        try {
            storage.exists(PROBE_KEY);
        } catch (StorageException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            log.warn("Clip retention: the storage cannot be asked, so this run removes nothing; the {} expired clips "
                    + "keep their rows and the next run takes them: {}", expired.size(), cause.toString());
            return;
        }

        int removed = 0;
        int failed = 0;
        for (long clipId : expired) {
            try {
                clips.delete(clipId);
                removed++;
            } catch (NotFoundException e) {
                log.debug("Clip retention: clip {} was deleted by someone else before its turn", clipId);
            } catch (RuntimeException e) {
                failed++;
                log.warn("Clip retention: could not remove clip {}, going on with the others: {}", clipId,
                        e.toString());
            }
        }
        log.info("Clip retention: {} of {} clips finished more than {} days ago removed, {} failed", removed,
                expired.size(), retentionDays, failed);
    }
}
