package io.csfaceit.backend.demo;

import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.match.MatchRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The database writes behind the demo endpoints. It is a bean of its own so that the transaction proxy applies:
 * {@link DemoService} loads from FACEIT with no transaction open, calls in here, and publishes its RabbitMQ
 * message only after the transaction has committed, so a consumer that receives the message always finds the row.
 *
 * <p>When a concurrent request inserts the same row first, PostgreSQL fails the insert with a unique violation,
 * which aborts the whole transaction and surfaces as a
 * {@link org.springframework.dao.DataIntegrityViolationException}; nothing is recovered in here. The caller repeats
 * the whole method, and the repeat finds the other request's row.
 */
@Component
public class DemoPersistence {

    /** Publishing to RabbitMQ failed, so the demo never started. Stored in {@code demos.error}. */
    static final String PUBLISH_FAILED = "The demo could not be queued for import: the message broker is unavailable";

    private final DemoRepository demos;
    private final MatchRepository matches;

    public DemoPersistence(DemoRepository demos, MatchRepository matches) {
        this.demos = demos;
        this.matches = matches;
    }

    /**
     * What {@link #queue} found or did. {@code publish} is true when this very call created the demo or moved it
     * back from FAILED to QUEUED, which is exactly when the import message has to be sent.
     */
    public record Queued(Demo demo, boolean publish) {
    }

    /**
     * Finds the demo of a stored match or creates it as QUEUED. A FAILED demo goes back to QUEUED; a demo in any
     * other status is left as it is. An existing row is read with a lock, so of several requests that revive the
     * same FAILED demo exactly one gets {@code publish == true}.
     */
    @Transactional
    public Queued queue(long matchRowId) {
        Demo existing = demos.findByMatchIdForUpdate(matchRowId).orElse(null);
        if (existing == null) {
            Match match = matches.findById(matchRowId)
                    .orElseThrow(() -> new IllegalStateException("Match " + matchRowId + " is not stored"));
            return new Queued(demos.save(new Demo(match)), true);
        }
        if (existing.getStatus() == DemoStatus.FAILED) {
            existing.transitionTo(DemoStatus.QUEUED);
            return new Queued(demos.saveAndFlush(existing), true);
        }
        return new Queued(existing, false);
    }

    /**
     * Marks a demo whose import message could not be published as FAILED, so that the next import request queues
     * it again. A demo that is no longer QUEUED has moved on and is left alone.
     */
    @Transactional
    public void failUnpublished(long demoId) {
        Demo demo = demos.findById(demoId).orElse(null);
        if (demo != null && demo.getStatus() == DemoStatus.QUEUED) {
            demo.fail(PUBLISH_FAILED);
            demos.save(demo);
        }
    }
}
