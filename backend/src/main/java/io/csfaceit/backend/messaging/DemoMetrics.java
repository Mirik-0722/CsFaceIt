package io.csfaceit.backend.messaging;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * The Micrometer meters of the demo pipeline, so that their names and tags are written down once. Prometheus shows
 * them as {@code demo_pipeline_stage_duration_seconds_*}, {@code demo_pipeline_failed_total} and
 * {@code demo_pipeline_parsed_total}. The tags have a handful of fixed values and never name a demo or a match: a
 * tag value per demo would create a new time series for every demo. The length of the queues and the dead-letter
 * queue come from RabbitMQ's own Prometheus endpoint, not from here.
 *
 * <p>The meters are registered at startup, so a counter that has not counted anything yet is exported as 0 instead
 * of being absent.
 */
@Component
public class DemoMetrics {

    /**
     * Queueing the import, downloading, storing and announcing a demo: a demo that could not be queued or announced
     * because the broker was unavailable counts here too.
     */
    public static final String STAGE_IMPORT = "import";

    /**
     * Parsing a stored demo (the Rust worker, which records its failures itself; the dead-letter listener counts them).
     */
    public static final String STAGE_PARSE = "parse";

    /** Working on a parsed demo (the analysis of a later sub-project). */
    public static final String STAGE_ANALYZE = "analyze";

    private static final String STAGE_TAG = "stage";

    private static final Map<String, String> STAGE_BY_QUEUE = Map.of(
            DemoMessages.Q_IMPORT, STAGE_IMPORT,
            DemoMessages.Q_PARSE, STAGE_PARSE,
            DemoMessages.Q_PARSED, STAGE_ANALYZE);

    private final MeterRegistry registry;
    private final Timer importDuration;
    private final Counter parsed;

    public DemoMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.importDuration = Timer.builder("demo.pipeline.stage.duration")
                .description("How long a stage of the demo pipeline took for one demo")
                .tag(STAGE_TAG, STAGE_IMPORT)
                .register(registry);
        this.parsed = Counter.builder("demo.pipeline.parsed")
                .description("Demos announced as parsed on demo.parsed")
                .register(registry);
        for (String stage : STAGE_BY_QUEUE.values()) {
            failedCounter(stage);
        }
    }

    /** Starts timing an import; hand the result to {@link #importFinished}. */
    public Timer.Sample startImport() {
        return Timer.start(registry);
    }

    /** Records the duration of an import, whether it succeeded or not. */
    public void importFinished(Timer.Sample sample) {
        sample.stop(importDuration);
    }

    /** Counts a demo that went to FAILED in {@code stage}; every such transition is counted once. */
    public void failed(String stage) {
        failedCounter(stage).increment();
    }

    /**
     * The stage a message belongs to, by the queue it was dead-lettered from; null for a queue that is not part of
     * the pipeline.
     */
    public static String stageOfQueue(String queue) {
        return STAGE_BY_QUEUE.get(queue);
    }

    /** Counts a demo that was announced as parsed and is waiting for the analysis. */
    public void parsed() {
        parsed.increment();
    }

    private Counter failedCounter(String stage) {
        return Counter.builder("demo.pipeline.failed")
                .description("Demos marked FAILED by the backend, by the stage they failed in")
                .tag(STAGE_TAG, stage)
                .register(registry);
    }
}
