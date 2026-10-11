package io.csfaceit.backend.messaging;

import io.csfaceit.backend.analysis.AnalysisService;
import io.csfaceit.backend.messaging.DemoMessages.DemoParsed;
import io.micrometer.core.instrument.Timer;
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
 * {@link AnalysisService} logs it and writes nothing. A failure of the analysis (the database is unavailable, say) is
 * not caught: the message is tried three times and then dead-lettered, and {@link DemoDlqListener} records the
 * failure on the demo, which stays PARSED so that the analysis can be started again.
 */
@Component
public class DemoParsedListener {

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
            analysis.analyze(message.demoId());
        } finally {
            metrics.analyzeFinished(sample);
        }
    }
}
