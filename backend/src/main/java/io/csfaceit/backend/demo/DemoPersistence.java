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

    /** A demo whose file is in storage, with what the {@code demo.parse} message about it has to say. */
    public record StoredDemo(long demoId, String faceitMatchId, String storageKey) {
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
     *
     * @return whether the demo was marked
     */
    @Transactional
    public boolean failUnpublished(long demoId) {
        return failIfStatus(demoId, DemoStatus.QUEUED, PUBLISH_FAILED);
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
     * Whether the demo is still QUEUED, that is, still waiting for the import that is running. It is asked before the
     * downloaded file is put in storage: a manual upload may have stored the demo while the download was running,
     * and the downloaded file must not replace it.
     */
    @Transactional(readOnly = true)
    public boolean isQueued(long demoId) {
        return demos.findById(demoId).filter(demo -> demo.getStatus() == DemoStatus.QUEUED).isPresent();
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
     * Records that a file the caller put in storage by hand is the demo of the match: the demo becomes STORED with
     * {@code storageKey} whatever its status is (see {@link Demo#restore}), and a match without a demo gets one. The
     * row is locked, so this and an import of the same demo take their turns, and an import never overwrites what this
     * has written to the row: once this has committed, an import that asks {@link #isQueued} is told no and drops its
     * downloaded file, and its {@link #markStored} finds the demo no longer QUEUED and changes nothing.
     *
     * <p>The object under the storage key is not protected the same way, because storage and database cannot be
     * changed in one step. The uploaded object is lost, replaced by the downloaded file, when the import's
     * {@code isQueued} check ran before this method committed (the demo was still QUEUED) and the import's
     * {@code put} ran after the upload's own {@code put}: upload {@code put}, import {@code isQueued}, import
     * {@code put}, upload commit. The row is then correct (STORED, announced for parsing), but the file the parser
     * reads is the downloaded one.
     *
     * @return the demo as it is now
     */
    @Transactional
    public Demo restore(long matchRowId, String storageKey) {
        Demo demo = demos.findByMatchIdForUpdate(matchRowId).orElse(null);
        if (demo == null) {
            Match match = matches.findById(matchRowId)
                    .orElseThrow(() -> new IllegalStateException("Match " + matchRowId + " is not stored"));
            demo = new Demo(match);
        }
        demo.restore(storageKey);
        return demos.saveAndFlush(demo);
    }

    /**
     * The demo, if it is STORED: what a redelivered import message needs to announce it again.
     *
     * @return empty when the demo does not exist or has any other status
     */
    @Transactional(readOnly = true)
    public Optional<StoredDemo> findStored(long demoId) {
        return demos.findById(demoId)
                .filter(demo -> demo.getStatus() == DemoStatus.STORED)
                .map(demo -> new StoredDemo(demoId, demo.getMatch().getFaceitMatchId(), demo.getStorageKey()));
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
     * The status of the demo, for a listener that only wants to know whether the demo is there and where it is.
     *
     * @return empty when there is no such demo
     */
    @Transactional(readOnly = true)
    public Optional<DemoStatus> findStatus(long demoId) {
        return demos.findById(demoId).map(Demo::getStatus);
    }

    /**
     * Forgets the file of a demo whose stored file has been removed: {@code storage_key} becomes NULL. The status, the
     * error and the facts the parser wrote stay as they are, and so does {@code updated_at}: nothing happened to the
     * demo's place in the pipeline, and a parser that is working on it must not take this for a new upload.
     *
     * @return the number of demos that pointed at the key (0 when the file belonged to none, which is normal for a
     *         file that an earlier run has already cleared)
     */
    @Transactional
    public int clearStorageKey(String storageKey) {
        return demos.clearStorageKey(storageKey);
    }

    private boolean isStaleQueued(Demo demo) {
        return demo.getStatus() == DemoStatus.QUEUED
                && demo.getUpdatedAt().isBefore(clock.instant().minus(STALE_QUEUED_AFTER));
    }
}
