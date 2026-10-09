package io.csfaceit.backend.messaging;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.demo.DemoPersistence;
import io.csfaceit.backend.demo.DemoStatus;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.retry.RepublishMessageRecoverer;
import org.springframework.stereotype.Component;

/**
 * Turns a dead-lettered message into a FAILED demo, but only a demo that is where the message left it. Messages of all
 * three queues end up in {@code demo.dlq} and all of them carry a {@code demoId}, so the body is read as plain JSON and
 * no message type is assumed. What the message may do depends on the queue it was dead-lettered from: one from
 * {@code demo.import} fails a QUEUED demo, one from {@code demo.parse} a STORED demo and one from {@code demo.parsed}
 * a PARSED demo, and no other. A demo that has moved on since (parsed, uploaded again, failed with a more specific
 * error of its own) is not undone by a message that is late, repeated or made up. A message whose origin cannot be
 * told is logged at WARN and changes nothing. The check and the update happen in one transaction under the row lock
 * ({@link DemoPersistence#failIfStatus}).
 *
 * <p>A message that cannot be read, or has no usable {@code demoId}, is logged and dropped: throwing would send it
 * round the dead-letter queue forever.
 *
 * <p>The listener has a container factory of its own: it retries a failure a few times and then drops the message
 * instead of republishing it to {@code demo.dlx}, because a republished dead letter would land in this very queue
 * again (see {@link RabbitConfig#dlqListenerContainerFactory}).
 *
 * <p>{@code demos.error} is shown to users, so it is a fixed sentence per queue. The exception text that the retry
 * recoverer puts in the message headers can name internal hosts and is only logged.
 */
@Component
public class DemoDlqListener {

    private static final Logger log = LoggerFactory.getLogger(DemoDlqListener.class);

    /** The header RabbitMQ adds when it dead-letters a message itself (a rejected one); a list of tables. */
    private static final String X_DEATH = "x-death";

    private static final String X_DEATH_QUEUE = "queue";

    /** The status a demo must have for a dead letter from the queue to fail it: where the queue's work starts. */
    private static final Map<String, DemoStatus> EXPECTED_STATUS = Map.of(
            DemoMessages.Q_IMPORT, DemoStatus.QUEUED,
            DemoMessages.Q_PARSE, DemoStatus.STORED,
            DemoMessages.Q_PARSED, DemoStatus.PARSED);

    private static final Map<String, String> ERROR_BY_QUEUE = Map.of(
            DemoMessages.Q_IMPORT, "Importing the demo failed after " + RabbitConfig.MAX_ATTEMPTS + " attempts",
            DemoMessages.Q_PARSE, "Parsing the demo failed after " + RabbitConfig.MAX_ATTEMPTS + " attempts",
            DemoMessages.Q_PARSED, "Analyzing the demo failed after " + RabbitConfig.MAX_ATTEMPTS + " attempts");

    private final DemoPersistence persistence;
    private final ObjectMapper mapper;
    private final DemoMetrics metrics;

    public DemoDlqListener(DemoPersistence persistence, ObjectMapper mapper, DemoMetrics metrics) {
        this.persistence = persistence;
        this.mapper = mapper;
        this.metrics = metrics;
    }

    @RabbitListener(queues = DemoMessages.DLQ, containerFactory = RabbitConfig.DLQ_LISTENER_CONTAINER_FACTORY)
    public void onDeadLetter(Message message) {
        String queue = originQueue(message);
        Long demoId = readDemoId(mapper, message);
        if (demoId == null) {
            log.warn("Dropping a dead-lettered message from {} that has no readable demoId", queue);
            return;
        }
        DemoStatus expected = queue == null ? null : EXPECTED_STATUS.get(queue);
        if (expected == null) {
            log.warn("Leaving demo {} untouched: a dead-lettered message names it, but the queue it came from ({}) "
                    + "cannot be told", demoId, queue);
            return;
        }
        String cause = header(message, RepublishMessageRecoverer.X_EXCEPTION_MESSAGE);
        if (persistence.failIfStatus(demoId, expected, ERROR_BY_QUEUE.get(queue))) {
            metrics.failed(DemoMetrics.stageOfQueue(queue));
            log.warn("Marked demo {} FAILED: a message from {} was dead-lettered ({})", demoId, queue, cause);
        } else {
            log.info("Dead-lettered message from {} for demo {}: the demo is unknown or no longer {}, left as it is",
                    queue, demoId, expected);
        }
    }

    /**
     * The queue the message was dead-lettered from, or null when its headers do not say. The first entry of the
     * broker's own {@code x-death} header names it when the broker dead-lettered the message (a rejection); a message
     * that the retry recoverer republished carries the routing key it was originally sent with, which is the queue's
     * name here.
     */
    static String originQueue(Message message) {
        String fromDeath = firstDeathQueue(message);
        return fromDeath != null ? fromDeath : header(message, RepublishMessageRecoverer.X_ORIGINAL_ROUTING_KEY);
    }

    /** The {@code queue} of the first {@code x-death} entry; headers of the wrong shape are taken as absent. */
    private static String firstDeathQueue(Message message) {
        Object deaths = message.getMessageProperties().getHeaders().get(X_DEATH);
        if (deaths instanceof List<?> list && !list.isEmpty() && list.get(0) instanceof Map<?, ?> first) {
            Object queue = first.get(X_DEATH_QUEUE);
            return queue == null ? null : queue.toString();
        }
        return null;
    }

    /** The {@code demoId} of the message body, or null when the body is not a JSON object with an integer demoId. */
    static Long readDemoId(ObjectMapper mapper, Message message) {
        byte[] body = message.getBody();
        if (body == null || body.length == 0) {
            return null;
        }
        try {
            JsonNode id = mapper.readTree(body).get("demoId");
            return id != null && id.isIntegralNumber() && id.canConvertToLong() ? id.longValue() : null;
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    private static String header(Message message, String name) {
        Object value = message.getMessageProperties().getHeaders().get(name);
        return value instanceof CharSequence ? value.toString() : null;
    }
}
