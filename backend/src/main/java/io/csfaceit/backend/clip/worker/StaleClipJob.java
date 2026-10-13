package io.csfaceit.backend.clip.worker;

import io.csfaceit.backend.clip.ClipErrorCode;
import io.csfaceit.backend.clip.ClipMetrics;
import io.csfaceit.backend.clip.ClipProperties;
import io.csfaceit.backend.clip.worker.WorkerPersistence.Ended;
import io.csfaceit.backend.clip.worker.WorkerPersistence.Fate;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Takes a clip back from a recorder that has gone quiet: the computer went to sleep, the game crashed, the network is
 * down. A recorder keeps its clip alive by reporting progress, at most {@code 10} seconds apart in every active stage;
 * a clip that has had no report for {@code clip.stale-after} is taken back, so that no clip stays active for ever. It
 * goes back to the queue, or is failed when it has had {@code clip.max-attempts} attempts, which is what bounds the
 * retries. The reason, shown with the clip until it is recorded again, is {@link ClipErrorCode#RECORDER_STOPPED}.
 *
 * <p>The clips that look silent are found with no lock, and each is then handled in a transaction of its own under its
 * row lock ({@link WorkerPersistence#takeBackIfSilent}), where it is looked at again: a progress report may have come
 * in between, and then the clip is left alone. One clip that cannot be handled is logged and skipped; it never stops
 * the run, and is found again at the next one. The job waits for a run to end before it counts the interval to the
 * next, so runs never overlap; a second backend instance running the job too only finds the clips already taken back.
 */
@Component
public class StaleClipJob {

    /** How long the job waits between one run and the next. */
    static final long INTERVAL_MILLIS = 30_000;

    private static final Logger log = LoggerFactory.getLogger(StaleClipJob.class);

    private final WorkerPersistence persistence;
    private final ClipProperties properties;
    private final Clock clock;
    private final ClipMetrics metrics;

    public StaleClipJob(WorkerPersistence persistence, ClipProperties properties, Clock clock, ClipMetrics metrics) {
        this.persistence = persistence;
        this.properties = properties;
        this.clock = clock;
        this.metrics = metrics;
    }

    @Scheduled(initialDelay = INTERVAL_MILLIS, fixedDelay = INTERVAL_MILLIS)
    public void takeBackSilentClips() {
        Instant cutoff = clock.instant().minus(properties.staleAfter());
        List<Long> silent;
        try {
            silent = persistence.findSilentClips(cutoff);
        } catch (RuntimeException e) {
            log.error("Could not look for clips that have gone silent, trying again at the next run", e);
            return;
        }
        for (long clipId : silent) {
            try {
                persistence.takeBackIfSilent(clipId, cutoff, ClipErrorCode.RECORDER_STOPPED, properties.maxAttempts())
                        .ifPresent(ended -> report(clipId, ended));
            } catch (RuntimeException e) {
                log.warn("Could not take back clip {}, going on with the others: {}", clipId, e.toString());
            }
        }
    }

    private void report(long clipId, Ended ended) {
        if (ended.fate() == Fate.REQUEUED) {
            metrics.requeued();
            log.warn("Clip {} had no report for over {} s: taken back and queued again (attempt {} of {})", clipId,
                    properties.staleAfter().toSeconds(), ended.attempts(), properties.maxAttempts());
        } else {
            metrics.failed();
            log.warn("Clip {} had no report for over {} s: failed, it has had its {} attempts", clipId,
                    properties.staleAfter().toSeconds(), ended.attempts());
        }
    }
}
