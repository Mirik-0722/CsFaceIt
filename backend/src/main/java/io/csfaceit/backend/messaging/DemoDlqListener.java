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
 * {@code demo.import} fails a QUEUED demo and one from {@code demo.parse} a STORED demo, and no other. A demo that has
 * moved on since (parsed, uploaded again, failed with a more specific error of its own) is not undone by a message
 * that is late, repeated or made up. A message whose origin cannot be told is logged at WARN and changes nothing. The
 * check and the update happen in one transaction under the row lock ({@link DemoPersistence#failIfStatus}).
 *
 * <p>A message from {@code demo.parsed} is an analysis that failed three times, and it never fails the demo: the
 * parser's facts are intact, so a PARSED demo stays PARSED and gets the sentence {@link #ANALYSIS_FAILED} as its
 * error, from which an analysis that is started again (or a new upload) frees it
 * ({@link DemoPersistence#noteAnalysisFailure}). An ANALYZED demo whose repeated analysis failed keeps the statistics
 * of the earlier one and is not touched; the failure is only logged at ERROR. In both cases it is counted in
 * {@code demo.pipeline.failed} as stage {@code analyze}. A demo in any other status has moved on, and the message
 * changes and counts nothing.
 *
 * <p>One failure reaches this queue after the demo is already FAILED: the Rust parser records a failed parse itself
 * and then rejects the {@code demo.parse} message without requeue, so the broker dead-letters it. Such a demo is FAILED
 * where STORED is expected and stays as it is, but the failure belongs in {@code demo.pipeline.failed} like any other,
 * so it is counted here as stage {@code parse}: the broker's {@code x-death} header says the message was rejected from
 * {@code demo.parse}, and the demo is FAILED. The two counting branches exclude each other (the listener either marked
 * the demo itself or found it marked), and a rejected download of the import worker, which counts itself, is a
 * {@code demo.import} dead letter that never reaches the second branch. Without a message id the second branch cannot
 * tell a rejection of a message for a demo that was FAILED for another reason from the parser's own, and a message
 * delivered to this listener twice (the first delivery was not acknowledged) counts twice.
 *
 * <p>A message that cannot be read, or has no usable {@code demoId}, is logged and dropped: throwing would send it
 * round the dead-letter queue forever. The listener's container factory hands the message over without trying to
 * convert it, so a body that is not JSON is such a message too and never an exception.
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

    private static final String X_DEATH_REASON = "reason";

    /** The {@code x-death} reason of a message that its consumer rejected without requeue. */
    private static final String REASON_REJECTED = "rejected";

    /**
     * The status a demo must have for a dead letter from the queue to fail it: where the queue's work starts. Not
     * {@code demo.parsed}: its dead letters never fail a demo (see {@link #onAnalysisDeadLetter}).
     */
    private static final Map<String, DemoStatus> EXPECTED_STATUS = Map.of(
            DemoMessages.Q_IMPORT, DemoStatus.QUEUED,
            DemoMessages.Q_PARSE, DemoStatus.STORED);

    private static final Map<String, String> ERROR_BY_QUEUE = Map.of(
            DemoMessages.Q_IMPORT, "Importing the demo failed after " + RabbitConfig.MAX_ATTEMPTS + " attempts",
            DemoMessages.Q_PARSE, "Parsing the demo failed after " + RabbitConfig.MAX_ATTEMPTS + " attempts");

    /** What {@code demos.error} says of a PARSED demo whose analysis failed for good. */
    static final String ANALYSIS_FAILED = "Analyzing the demo failed after " + RabbitConfig.MAX_ATTEMPTS
            + " attempts. The parsed data is kept; start the analysis again.";

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
        String cause = header(message, RepublishMessageRecoverer.X_EXCEPTION_MESSAGE);
        if (DemoMessages.Q_PARSED.equals(queue)) {
            onAnalysisDeadLetter(demoId, cause);
            return;
        }
        DemoStatus expected = queue == null ? null : EXPECTED_STATUS.get(queue);
        if (expected == null) {
            log.warn("Leaving demo {} untouched: a dead-lettered message names it, but the queue it came from ({}) "
                    + "cannot be told", demoId, queue);
            return;
        }
        if (persistence.failIfStatus(demoId, expected, ERROR_BY_QUEUE.get(queue))) {
            // The demo is FAILED and committed. Nothing that can throw may follow: a retry of this message would find
            // the demo FAILED and could count it a second time in the branch below.
            metrics.failed(DemoMetrics.stageOfQueue(queue));
            log.warn("Marked demo {} FAILED: a message from {} was dead-lettered ({})", demoId, queue, cause);
        } else if (rejectedByParser(message, queue) && isFailed(demoId)) {
            metrics.failed(DemoMetrics.STAGE_PARSE);
            log.info("Dead-lettered message from {} for demo {}: the parser rejected it after marking the demo FAILED "
                    + "itself, counted as a failed parse", queue, demoId);
        } else {
            log.info("Dead-lettered message from {} for demo {}: the demo is unknown or no longer {}, left as it is",
                    queue, demoId, expected);
        }
    }

    /**
     * A {@code demo.parsed} message that could not be processed: the analysis of the demo failed three times. The demo
     * is not FAILED, its facts are fine. A PARSED demo gets {@link #ANALYSIS_FAILED} as its error and stays PARSED. An
     * ANALYZED demo (an analysis that was started again failed) keeps the results of its earlier analysis, so only the
     * log and the counter tell. Either is one failed analysis in {@code demo.pipeline.failed}, stage {@code analyze}.
     * For any other demo, or none, the message is late or made up and nothing happens.
     */
    private void onAnalysisDeadLetter(long demoId, String cause) {
        if (persistence.noteAnalysisFailure(demoId, ANALYSIS_FAILED)) {
            // The error is committed. Nothing that can throw may follow: a retry of this message would note the
            // error again and count the failure a second time.
            metrics.failed(DemoMetrics.STAGE_ANALYZE);
            log.warn("The analysis of demo {} failed for good ({}); the demo stays PARSED with the error noted, and "
                    + "the analysis can be started again", demoId, cause);
        } else if (persistence.findStatus(demoId).filter(status -> status == DemoStatus.ANALYZED).isPresent()) {
            metrics.failed(DemoMetrics.STAGE_ANALYZE);
            log.error("Analyzing demo {} again failed for good ({}); the demo stays ANALYZED with the results of the "
                    + "earlier analysis", demoId, cause);
        } else {
            log.info("Dead-lettered message from {} for demo {}: the demo is unknown or neither PARSED nor ANALYZED, "
                    + "left as it is", DemoMessages.Q_PARSED, demoId);
        }
    }

    /**
     * Whether the broker dead-lettered the message because its consumer rejected it, from {@code demo.parse}. The
     * Rust parser is the only consumer of that queue, and it rejects a message after it has marked the demo FAILED.
     * The broker writes {@code x-death} when it dead-letters a message, so a message that the retry recoverer
     * republished, or that somebody published by hand without such a header, has no reason and does not qualify.
     */
    private static boolean rejectedByParser(Message message, String queue) {
        return DemoMessages.Q_PARSE.equals(queue) && REASON_REJECTED.equals(firstDeathField(message, X_DEATH_REASON));
    }

    private boolean isFailed(long demoId) {
        return persistence.findStatus(demoId).filter(status -> status == DemoStatus.FAILED).isPresent();
    }

    /**
     * The queue the message was dead-lettered from, or null when its headers do not say. The first entry of the
     * broker's own {@code x-death} header names it when the broker dead-lettered the message (a rejection); a message
     * that the retry recoverer republished carries the routing key it was originally sent with, which is the queue's
     * name here.
     */
    static String originQueue(Message message) {
        String fromDeath = firstDeathField(message, X_DEATH_QUEUE);
        return fromDeath != null ? fromDeath : header(message, RepublishMessageRecoverer.X_ORIGINAL_ROUTING_KEY);
    }

    /**
     * A field of the first {@code x-death} entry (the broker puts the most recent death first) as text, for example
     * its {@code queue} or {@code reason}; null when the header or the field is absent. A header of the wrong shape is
     * taken as absent.
     */
    private static String firstDeathField(Message message, String name) {
        Object deaths = message.getMessageProperties().getHeaders().get(X_DEATH);
        if (deaths instanceof List<?> list && !list.isEmpty() && list.get(0) instanceof Map<?, ?> first) {
            Object value = first.get(name);
            return value == null ? null : value.toString();
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
