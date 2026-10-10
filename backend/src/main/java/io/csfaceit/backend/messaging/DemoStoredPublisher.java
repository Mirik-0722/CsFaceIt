package io.csfaceit.backend.messaging;

import io.csfaceit.backend.demo.DemoPersistence;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.messaging.DemoMessages.DemoStored;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.AmqpTemplate;
import org.springframework.stereotype.Component;

/**
 * Announces on {@code demo.parse} that a demo is in storage. Every way a demo becomes STORED ends here (the import
 * worker, a redelivered import message, a manual upload), so that they all handle a failed publish alike. The caller
 * calls this only after the STORED status has been committed: a parser that receives the message must find the demo
 * in the state the message is about.
 */
@Component
public class DemoStoredPublisher {

    /** Stored in {@code demos.error} when the demo is stored but {@code demo.parse} could not be published. */
    static final String PARSE_PUBLISH_FAILED =
            "The demo was stored but could not be queued for parsing: the message broker is unavailable";

    private static final Logger log = LoggerFactory.getLogger(DemoStoredPublisher.class);

    private final AmqpTemplate amqp;
    private final DemoPersistence persistence;
    private final DemoMetrics metrics;

    public DemoStoredPublisher(AmqpTemplate amqp, DemoPersistence persistence, DemoMetrics metrics) {
        this.amqp = amqp;
        this.persistence = persistence;
        this.metrics = metrics;
    }

    /**
     * Publishes {@code demo.parse}. When that fails the demo is STORED with nobody to parse it, so it is marked FAILED
     * (a new import request or upload queues it again), counted as a failed import, and the failure is thrown.
     */
    public void publish(long demoId, String faceitMatchId, String storageKey) {
        try {
            amqp.convertAndSend(DemoMessages.EXCHANGE, DemoMessages.Q_PARSE,
                    new DemoStored(demoId, faceitMatchId, storageKey));
        } catch (RuntimeException e) {
            log.error("Could not publish {} for demo {} of match {}, marking the demo FAILED", DemoMessages.Q_PARSE,
                    demoId, faceitMatchId, e);
            try {
                if (persistence.failIfStatus(demoId, DemoStatus.STORED, PARSE_PUBLISH_FAILED)) {
                    metrics.failed(DemoMetrics.STAGE_IMPORT);
                }
            } catch (RuntimeException markFailure) {
                log.error("Could not mark demo {} FAILED; it stays STORED without a parse message", demoId,
                        markFailure);
                e.addSuppressed(markFailure);
            }
            throw e;
        }
    }
}
