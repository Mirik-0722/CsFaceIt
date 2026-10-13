package io.csfaceit.backend.messaging;

import io.csfaceit.backend.analysis.AnalysisService;
import io.csfaceit.backend.messaging.DemoMessages.DemoParsed;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * Receives {@code demo.parsed}, the announcement the Rust parser makes once a demo's facts are in the database (and
 * the backend itself makes for a request to analyze a demo again), and has {@link AnalysisService} analyze the demo,
 * which moves it from PARSED to ANALYZED. The message is counted ({@code demo.pipeline.parsed}) and the analysis is
 * timed ({@code demo.pipeline.stage.duration}, stage {@code analyze}), each time the listener handles the message.
 *
 * <p>The message comes from the parser, as plain JSON without the type header Spring adds to the messages it sends;
 * the type to read is the one of the method's parameter (see {@link RabbitConfig#messageConverter}).
 *
 * <p>Delivery is at least once, and the analysis is idempotent, so a message that arrives twice, or for a demo that is
 * not there or is no longer PARSED (it has been uploaded again and is on its way to a new parse), is harmless:
 * {@link AnalysisService} logs it and writes nothing. A failure of the analysis (a rule that meets facts it cannot
 * handle, say) is logged here, once, at ERROR with the exception and its stack trace, and then rethrown: the message is
 * tried three times and then dead-lettered, and {@link DemoDlqListener} records the failure on the demo, which stays
 * PARSED so that the analysis can be started again. This is the only place that logs the exception itself. Each of the
 * attempts is a failure of its own and is logged as one; neither the retry nor the dead-letter listener logs the trace
 * again (the dead letter carries it in its {@code x-exception-stacktrace} header, but nothing reads it out; the
 * dead-letter listener logs the exception's message only). An {@link Error} is logged the same way, and since the retry
 * does not repeat it (see {@link RabbitConfig#rabbitListenerContainerFactory}) its message is dead-lettered at once:
 * this is the one place its stack trace is logged.
 */
@Component
public class DemoParsedListener {

    private static final Logger log = LoggerFactory.getLogger(DemoParsedListener.class);

    private final AnalysisService analysis;
    private final DemoMetrics metrics;

    public DemoParsedListener(AnalysisService analysis, DemoMetrics metrics) {
        this.analysis = analysis;
        this.metrics = metrics;
    }

    @RabbitListener(queues = DemoMessages.Q_PARSED)
    public void onParsed(DemoParsed message) {
        metrics.parsed();
        Timer.Sample sample = metrics.startAnalyze();
        try {
            if (analysis.analyze(message.demoId()) == AnalysisService.Outcome.WRONG_MATCH) {
                // The demo went to FAILED in the analysis stage, by this very delivery (a repeated message finds it
                // FAILED and gets another outcome), so it is counted once like a demo that fails anywhere else.
                metrics.failed(DemoMetrics.STAGE_ANALYZE);
            }
        } catch (RuntimeException | Error e) {
            log.error("Analyzing demo {} of match {} failed", message.demoId(), message.faceitMatchId(), e);
            throw e;
        } finally {
            metrics.analyzeFinished(sample);
        }
    }
}
