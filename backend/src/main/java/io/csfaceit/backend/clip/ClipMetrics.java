package io.csfaceit.backend.clip;

import io.csfaceit.backend.clip.dto.RecorderStatusResponse;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.function.ToDoubleFunction;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The Micrometer meters of the clip pipeline, so that their names and tags are written down once. Prometheus shows
 * them as {@code clips_requested_total{kind}}, {@code clips_finished_total{status}}, {@code clips_requeued_total},
 * {@code clips_record_duration_seconds_*}, {@code clips_queue_size}, {@code clips_active} and
 * {@code clips_recorder_online}. The tags have a handful of fixed values, the names of {@link ClipKind} and of the two
 * final {@link ClipStatus} constants, and never name a clip, a match or a player: a tag value per clip would create a
 * new time series for every clip.
 *
 * <p>The counters and the timer are fed by whoever changed a clip, and only after the transaction of the change has
 * committed, as {@code DemoMetrics} is used: a change that was rolled back is not counted. They are registered at
 * startup, so a counter that has not counted anything yet is exported as 0 instead of being absent.
 * <ul>
 *   <li>{@link #requested}: a request that queued a new clip. A request answered with the clip that was already there
 *       is not counted.
 *   <li>{@link #done} and {@link #failed}: every arrival of a clip in {@code DONE} or {@code FAILED}, whoever caused
 *       it: the recorder's completion or failure, the check that takes back a silent clip, a claim that found the
 *       demo file gone or the player's SteamID unknown.
 *   <li>{@link #requeued}: every return of a clip to the queue: a failure the recorder said may be retried, a clip
 *       taken back from a silent recorder, and a claim that was given back because the storage could not be asked.
 *   <li>{@link #recorded}: the time from {@code claimed_at} to {@code finished_at} of a clip that became {@code DONE},
 *       that is of the attempt that succeeded.
 * </ul>
 *
 * <p>The three gauges come from the database: the clips waiting, the clips a recorder holds, and whether a recorder
 * was seen within {@code clip.worker-online-within} (1 or 0), the same figures as {@code GET /api/v1/recorder/status}.
 * They are read by a job every {@value #GAUGE_REFRESH_MILLIS} milliseconds and not when Prometheus scrapes: a scrape
 * that read the database would wait for a connection while the database is down (the pool waits 30 seconds by
 * default), run into the scrape timeout, and lose every other metric of the backend with it, just when they are needed.
 * A scrape therefore never touches the database. While the database cannot be read the gauges are {@code NaN},
 * "unknown", and not a figure that has gone out of date.
 */
@Component
public class ClipMetrics {

    /** How long the job that reads the gauges waits between one read and the next. */
    static final long GAUGE_REFRESH_MILLIS = 10_000;

    private static final String KIND_TAG = "kind";
    private static final String STATUS_TAG = "status";

    private static final Logger log = LoggerFactory.getLogger(ClipMetrics.class);

    private final ClipQueryService queries;
    private final Map<ClipKind, Counter> requested = new EnumMap<>(ClipKind.class);
    private final Map<ClipStatus, Counter> finished = new EnumMap<>(ClipStatus.class);
    private final Counter requeued;
    private final Timer recordDuration;

    /** What the gauges show, as of the last read; {@code null} before the first read and while the database fails. */
    private volatile RecorderStatusResponse status;

    /** Whether the last read failed, so that an outage is logged once and not at every read. */
    private volatile boolean unreadable;

    public ClipMetrics(MeterRegistry registry, ClipQueryService queries) {
        this.queries = queries;
        for (ClipKind kind : ClipKind.values()) {
            requested.put(kind, Counter.builder("clips.requested")
                    .description("Requests that queued a new clip, by kind; a request answered with the clip that "
                            + "was already there is not counted")
                    .tag(KIND_TAG, kind.name())
                    .register(registry));
        }
        for (ClipStatus ending : List.of(ClipStatus.DONE, ClipStatus.FAILED)) {
            finished.put(ending, Counter.builder("clips.finished")
                    .description("Clips that arrived in a final status, by status, whoever caused it")
                    .tag(STATUS_TAG, ending.name())
                    .register(registry));
        }
        this.requeued = Counter.builder("clips.requeued")
                .description("Clips that went back to the queue: a retryable failure, a recorder that went silent, "
                        + "a claim given back")
                .register(registry);
        this.recordDuration = Timer.builder("clips.record.duration")
                .description("How long a clip that became DONE was held by its recorder, from the claim to the end")
                .register(registry);
        registerGauge(registry, "clips.queue.size", "Clips waiting in the queue for a recorder",
                RecorderStatusResponse::queued);
        registerGauge(registry, "clips.active", "Clips a recorder is working on: recording, encoding or uploading",
                RecorderStatusResponse::active);
        registerGauge(registry, "clips.recorder.online",
                "1 when a recorder was seen within clip.worker-online-within, else 0",
                recorder -> recorder.online() ? 1 : 0);
    }

    /** Counts a request that queued a new clip of that kind. */
    public void requested(ClipKind kind) {
        requested.get(kind).increment();
    }

    /** Counts a clip that became {@code DONE}. */
    public void done() {
        finished.get(ClipStatus.DONE).increment();
    }

    /** Counts a clip that became {@code FAILED}. */
    public void failed() {
        finished.get(ClipStatus.FAILED).increment();
    }

    /** Counts a clip that went back to the queue. */
    public void requeued() {
        requeued.increment();
    }

    /** Records how long a clip that became {@code DONE} was held, from its claim to its end. */
    public void recorded(Duration held) {
        recordDuration.record(held);
    }

    /**
     * Reads what the gauges show. A failure is not thrown: the gauges go to "unknown" ({@code NaN}) and the next read
     * tries again. The first failure of a run is logged, the end of it too, and the reads in between are silent.
     */
    @Scheduled(fixedDelay = GAUGE_REFRESH_MILLIS)
    public void readGauges() {
        try {
            status = queries.recorderStatus();
        } catch (RuntimeException e) {
            status = null;
            if (!unreadable) {
                log.warn("The clip gauges cannot be read from the database and show NaN until they can: {}",
                        e.toString());
            }
            unreadable = true;
            return;
        }
        if (unreadable) {
            log.info("The clip gauges are read from the database again");
            unreadable = false;
        }
    }

    private void registerGauge(MeterRegistry registry, String name, String description,
                               ToDoubleFunction<RecorderStatusResponse> value) {
        Gauge.builder(name, this, metrics -> metrics.reading(value))
                .description(description)
                .register(registry);
    }

    private double reading(ToDoubleFunction<RecorderStatusResponse> value) {
        RecorderStatusResponse read = status;
        return read == null ? Double.NaN : value.applyAsDouble(read);
    }
}
