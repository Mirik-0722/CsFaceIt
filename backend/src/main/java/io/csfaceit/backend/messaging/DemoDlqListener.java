package io.csfaceit.backend.messaging;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.csfaceit.backend.demo.DemoPersistence;
import java.io.IOException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.retry.RepublishMessageRecoverer;
import org.springframework.stereotype.Component;

/**
 * Turns a dead-lettered message into a FAILED demo. Messages of all three queues end up in {@code demo.dlq} and all
 * of them carry a {@code demoId}, so the body is read as plain JSON and no message type is assumed. A message that
 * cannot be read, or has no usable {@code demoId}, is logged and dropped: throwing would send it round the dead-letter
 * queue forever.
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

    /** What a message with an unknown origin gets as its error. */
    static final String DEFAULT_ERROR = "Processing failed after " + RabbitConfig.MAX_ATTEMPTS + " attempts";

    /** RabbitMQ sets this header on a message that its own dead-lettering moved (a rejected one). */
    private static final String FIRST_DEATH_QUEUE = "x-first-death-queue";

    private static final Map<String, String> ERROR_BY_QUEUE = Map.of(
            DemoMessages.Q_IMPORT, "Importing the demo failed after " + RabbitConfig.MAX_ATTEMPTS + " attempts",
            DemoMessages.Q_PARSE, "Parsing the demo failed after " + RabbitConfig.MAX_ATTEMPTS + " attempts",
            DemoMessages.Q_PARSED, "Analyzing the demo failed after " + RabbitConfig.MAX_ATTEMPTS + " attempts");

    private final DemoPersistence persistence;
    private final ObjectMapper mapper;

    public DemoDlqListener(DemoPersistence persistence, ObjectMapper mapper) {
        this.persistence = persistence;
        this.mapper = mapper;
    }

    @RabbitListener(queues = DemoMessages.DLQ, containerFactory = RabbitConfig.DLQ_LISTENER_CONTAINER_FACTORY)
    public void onDeadLetter(Message message) {
        String queue = originQueue(message);
        Long demoId = readDemoId(mapper, message);
        if (demoId == null) {
            log.warn("Dropping a dead-lettered message from {} that has no readable demoId", queue);
            return;
        }
        String cause = header(message, RepublishMessageRecoverer.X_EXCEPTION_MESSAGE);
        String error = queue == null ? DEFAULT_ERROR : ERROR_BY_QUEUE.getOrDefault(queue, DEFAULT_ERROR);
        boolean marked = persistence.failDeadLettered(demoId, error);
        if (marked) {
            log.warn("Marked demo {} FAILED: a message from {} was dead-lettered ({})", demoId, queue, cause);
        } else {
            log.info("Dead-lettered message from {} for demo {}: the demo is unknown, FAILED already, or finished",
                    queue, demoId);
        }
    }

    /** The queue the message was dead-lettered from, or null when its headers do not say. */
    static String originQueue(Message message) {
        return firstNonNull(header(message, RepublishMessageRecoverer.X_ORIGINAL_ROUTING_KEY),
                header(message, FIRST_DEATH_QUEUE));
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

    private static String firstNonNull(String first, String second) {
        return first != null ? first : second;
    }
}
