package io.csfaceit.backend.messaging;

import io.csfaceit.backend.demo.DemoPersistence;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.messaging.DemoMessages.DemoParsed;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * Receives {@code demo.parsed}, the announcement the Rust parser makes once a demo's facts are in the database. For now
 * that is all there is to do: the message is logged and counted ({@code demo.pipeline.parsed}). The demo stays PARSED;
 * the analysis of a later sub-project is what moves it on to ANALYZED.
 *
 * <p>The message comes from the parser, as plain JSON without the type header Spring adds to the messages it sends;
 * the type to read is the one of the method's parameter (see {@link RabbitConfig#messageConverter}).
 *
 * <p>Delivery is at least once, so the listener is idempotent and never throws for the demo itself: a message for a
 * demo that does not exist, or that is not PARSED (it has been analysed since, or uploaded again and is on its way to
 * a new parse), is logged and acknowledged without counting.
 *
 * <p>Nothing in here may get a successfully parsed demo marked FAILED. The status is read only to keep the counter
 * honest, so a failure of that read (the database is unavailable for a moment) must not fail the message: a message
 * that fails is retried, then dead-lettered with {@code demo.parsed} as its origin, and the dead-letter listener
 * fails a PARSED demo for exactly that. The failure is logged at WARN without a stack trace, the message is counted
 * as parsed (it announces a parse that did happen) and acknowledged.
 */
@Component
public class DemoParsedListener {

    private static final Logger log = LoggerFactory.getLogger(DemoParsedListener.class);

    private final DemoPersistence persistence;
    private final DemoMetrics metrics;

    public DemoParsedListener(DemoPersistence persistence, DemoMetrics metrics) {
        this.persistence = persistence;
        this.metrics = metrics;
    }

    @RabbitListener(queues = DemoMessages.Q_PARSED)
    public void onParsed(DemoParsed message) {
        long demoId = message.demoId();
        Optional<DemoStatus> status;
        try {
            status = persistence.findStatus(demoId);
        } catch (RuntimeException e) {
            log.warn("Could not look up demo {} of match {} ({}); counting {} without the check and acknowledging it",
                    demoId, message.faceitMatchId(), e.toString(), DemoMessages.Q_PARSED);
            metrics.parsed();
            return;
        }
        if (status.isEmpty()) {
            log.warn("Ignoring {} for demo {} of match {}: there is no such demo", DemoMessages.Q_PARSED, demoId,
                    message.faceitMatchId());
            return;
        }
        if (status.get() != DemoStatus.PARSED) {
            log.info("Ignoring {} for demo {} of match {}: the demo is {}, not PARSED", DemoMessages.Q_PARSED, demoId,
                    message.faceitMatchId(), status.get());
            return;
        }
        metrics.parsed();
        log.info("Demo {} of match {} is parsed and waits for the analysis", demoId, message.faceitMatchId());
    }
}
