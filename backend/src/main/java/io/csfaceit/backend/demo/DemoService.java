package io.csfaceit.backend.demo;

import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.demo.DemoPersistence.Queued;
import io.csfaceit.backend.demo.dto.DemoResponse;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.match.MatchService;
import io.csfaceit.backend.messaging.DemoMessages;
import io.csfaceit.backend.messaging.DemoMessages.DemoImportRequested;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.AmqpTemplate;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Starts and reports the import of a match's demo. Like {@link MatchService} it opens no transaction itself: FACEIT
 * is called with none open, the database writes are the transactions of {@link DemoPersistence}, and the RabbitMQ
 * message goes out only after they have committed.
 */
@Service
public class DemoService {

    private static final String DEMO_NOT_FOUND = "DEMO_NOT_FOUND";
    private static final String DEMO_URL_UNAVAILABLE = "DEMO_URL_UNAVAILABLE";

    private static final Logger log = LoggerFactory.getLogger(DemoService.class);

    private final MatchService matchService;
    private final MatchRepository matches;
    private final DemoRepository demos;
    private final DemoPersistence persistence;
    private final AmqpTemplate amqp;

    public DemoService(MatchService matchService, MatchRepository matches, DemoRepository demos,
                       DemoPersistence persistence, AmqpTemplate amqp) {
        this.matchService = matchService;
        this.matches = matches;
        this.demos = demos;
        this.persistence = persistence;
        this.amqp = amqp;
    }

    /**
     * Queues the import of the match's demo. The match is loaded from FACEIT and stored first (this also gives the
     * demo URL), then the {@code demos} row is created, or revived when its import FAILED, and the
     * {@code demo.import} message is published once that row is committed. A demo that is already QUEUED or
     * further along is reported as it is, without a message. Repeating the request, also in parallel, therefore
     * leaves one row and queues one message.
     *
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match
     * @throws ConflictException {@code DEMO_URL_UNAVAILABLE}: FACEIT has no demo for the match (yet)
     */
    public DemoResponse requestImport(String faceitMatchId) {
        String demoUrl = matchService.getMatch(faceitMatchId).demoUrl();
        if (demoUrl == null || demoUrl.isBlank()) {
            throw new ConflictException(DEMO_URL_UNAVAILABLE, "FACEIT has no demo for match " + faceitMatchId);
        }
        long matchRowId = matches.findByFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new IllegalStateException("Match " + faceitMatchId + " is not stored"))
                .getId();

        Queued queued = persistWithRetry("demo of match " + faceitMatchId, () -> persistence.queue(matchRowId));
        if (queued.publish()) {
            publishImport(queued.demo().getId(), faceitMatchId, demoUrl);
        }
        return toResponse(faceitMatchId, queued.demo());
    }

    /** The stored state of the match's demo. */
    public DemoResponse get(String faceitMatchId) {
        Demo demo = demos.findByMatchFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new NotFoundException(DEMO_NOT_FOUND, "Demo not found for match: " + faceitMatchId));
        return toResponse(faceitMatchId, demo);
    }

    /**
     * Publishes the import request. When that fails the row is already committed as QUEUED with nothing to process
     * it, so it is marked FAILED (the next import request queues it again) and the failure reaches the caller.
     */
    private void publishImport(long demoId, String faceitMatchId, String demoUrl) {
        try {
            amqp.convertAndSend(DemoMessages.EXCHANGE, DemoMessages.Q_IMPORT,
                    new DemoImportRequested(demoId, faceitMatchId, demoUrl));
        } catch (RuntimeException e) {
            log.error("Could not publish {} for demo {} of match {}, marking the demo FAILED", DemoMessages.Q_IMPORT,
                    demoId, faceitMatchId, e);
            try {
                persistence.failUnpublished(demoId);
            } catch (RuntimeException markFailure) {
                log.error("Could not mark demo {} FAILED; it stays QUEUED without a message", demoId, markFailure);
                e.addSuppressed(markFailure);
            }
            throw e;
        }
    }

    /**
     * Runs one persistence step and, if it loses a first-access race, runs it once more. Two requests that meet a
     * match without a demo both find nothing and both insert; PostgreSQL fails the loser's insert with a unique
     * violation (or, rarely, a deadlock), which aborts that transaction. The repeat is a new transaction that finds
     * the winner's row, and its result says not to publish. A second failure is real and propagates.
     */
    private static <T> T persistWithRetry(String what, Supplier<T> persist) {
        try {
            return persist.get();
        } catch (DataIntegrityViolationException | ConcurrencyFailureException e) {
            log.info("Lost a concurrent first-access write race for {} ({}), retrying once", what,
                    e.getClass().getSimpleName());
            return persist.get();
        }
    }

    /** Takes the FACEIT match id from the caller: the entity's match is lazy and not loaded here. */
    private static DemoResponse toResponse(String faceitMatchId, Demo demo) {
        return new DemoResponse(demo.getId(), faceitMatchId, demo.getStatus(), demo.getError(), demo.getUpdatedAt());
    }
}
