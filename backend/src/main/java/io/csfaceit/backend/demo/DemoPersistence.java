package io.csfaceit.backend.demo;

import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.match.MatchRepository;
import java.time.Clock;
import java.time.Duration;
import java.util.Optional;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The database writes behind the demo endpoints and the import worker. It is a bean of its own so that the
 * transaction proxy applies: callers do their network and storage work with no transaction open, call in here for
 * each short status change, and publish their RabbitMQ message only after the transaction has committed, so a
 * consumer that receives the message always finds the row in the state the message is about.
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

    /**
     * A QUEUED demo that nothing has touched for this long is taken to have lost its message (the process died
     * between the commit and the publish, or the queue was purged) and may be queued again. It is far longer than a
     * normal import, which touches the row when it starts.
     */
    static final Duration STALE_QUEUED_AFTER = Duration.ofMinutes(10);

    private final DemoRepository demos;
    private final MatchRepository matches;
    private final Clock clock;

    public DemoPersistence(DemoRepository demos, MatchRepository matches, Clock clock) {
        this.demos = demos;
        this.matches = matches;
        this.clock = clock;
    }

    /**
     * What {@link #queue} found or did. {@code publish} is true when this very call created the demo or moved it
     * back to QUEUED, which is exactly when the import message has to be sent.
     */
    public record Queued(Demo demo, boolean publish) {
    }

    /** The demo an import worker has taken over; {@code faceitMatchId} is the match it belongs to, as stored. */
    public record ImportClaim(long demoId, String faceitMatchId) {
    }

    /**
     * Finds the demo of a stored match or creates it as QUEUED. A FAILED demo goes back to QUEUED, and so does a
     * QUEUED one that has been untouched for {@link #STALE_QUEUED_AFTER}; a demo in any other status is left as it
     * is. An existing row is read with a lock, so of several requests that revive the same demo exactly one gets
     * {@code publish == true}.
     *
     * @param demoUrlAvailable whether FACEIT has a demo URL for the match; without one nothing can be queued
     * @return empty when the demo would have to be queued but cannot be, because there is no demo URL; nothing is
     *         written then
     */
    @Transactional
    public Optional<Queued> queue(long matchRowId, boolean demoUrlAvailable) {
        Demo existing = demos.findByMatchIdForUpdate(matchRowId).orElse(null);
        if (existing == null) {
            if (!demoUrlAvailable) {
                return Optional.empty();
            }
            Match match = matches.findById(matchRowId)
                    .orElseThrow(() -> new IllegalStateException("Match " + matchRowId + " is not stored"));
            return Optional.of(new Queued(demos.save(new Demo(match)), true));
        }
        boolean failed = existing.getStatus() == DemoStatus.FAILED;
        if (!failed && !isStaleQueued(existing)) {
            return Optional.of(new Queued(existing, false));
        }
        if (!demoUrlAvailable) {
            return Optional.empty();
        }
        if (failed) {
            existing.transitionTo(DemoStatus.QUEUED);
        } else {
            existing.touch();
        }
        return Optional.of(new Queued(demos.saveAndFlush(existing), true));
    }

    /**
     * Marks a demo whose import message could not be published as FAILED, so that the next import request queues
     * it again. A demo that is no longer QUEUED has moved on and is left alone.
     */
    @Transactional
    public void failUnpublished(long demoId) {
        failIfStatus(demoId, DemoStatus.QUEUED, PUBLISH_FAILED);
    }

    /**
     * Takes over a demo for its import: under the row lock, a demo that is QUEUED is touched, so that a long
     * download is not mistaken for a lost message, and handed to the worker. Any other status means the message is
     * a duplicate or the demo has moved on, and nothing is changed.
     *
     * @return empty when there is nothing to import
     */
    @Transactional
    public Optional<ImportClaim> claimForImport(long demoId) {
        Demo demo = demos.findByIdForUpdate(demoId).orElse(null);
        if (demo == null || demo.getStatus() != DemoStatus.QUEUED) {
            return Optional.empty();
        }
        demo.touch();
        demos.saveAndFlush(demo);
        return Optional.of(new ImportClaim(demoId, demo.getMatch().getFaceitMatchId()));
    }

    /**
     * Records that the demo file is in storage: QUEUED becomes STORED with its storage key.
     *
     * @return false when the demo is no longer QUEUED (something else got there first); nothing is changed then
     */
    @Transactional
    public boolean markStored(long demoId, String storageKey) {
        Demo demo = demos.findByIdForUpdate(demoId).orElse(null);
        if (demo == null || demo.getStatus() != DemoStatus.QUEUED) {
            return false;
        }
        demo.transitionTo(DemoStatus.STORED);
        demo.setStorageKey(storageKey);
        demos.saveAndFlush(demo);
        return true;
    }

    /**
     * Marks the demo FAILED with {@code error}, but only if it still has the status {@code expected}; a demo that
     * has moved on in the meantime is left alone.
     *
     * @return whether the demo was marked
     */
    @Transactional
    public boolean failIfStatus(long demoId, DemoStatus expected, String error) {
        Demo demo = demos.findByIdForUpdate(demoId).orElse(null);
        if (demo == null || demo.getStatus() != expected) {
            return false;
        }
        demo.fail(error);
        demos.saveAndFlush(demo);
        return true;
    }

    /**
     * Marks a demo whose message was dead-lettered as FAILED. A demo that is already FAILED keeps its own, more
     * specific error, and one that is ANALYZED has finished its run and is not undone by a stray message.
     *
     * @return whether the demo was marked
     */
    @Transactional
    public boolean failDeadLettered(long demoId, String error) {
        Demo demo = demos.findByIdForUpdate(demoId).orElse(null);
        if (demo == null || demo.getStatus() == DemoStatus.FAILED || demo.getStatus() == DemoStatus.ANALYZED) {
            return false;
        }
        demo.fail(error);
        demos.saveAndFlush(demo);
        return true;
    }

    private boolean isStaleQueued(Demo demo) {
        return demo.getStatus() == DemoStatus.QUEUED
                && demo.getUpdatedAt().isBefore(clock.instant().minus(STALE_QUEUED_AFTER));
    }
}
