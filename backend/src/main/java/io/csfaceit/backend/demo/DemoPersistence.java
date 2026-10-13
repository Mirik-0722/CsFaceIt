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
     * A QUEUED or STORED demo that nothing has touched for this long is taken to have lost its message (the process
     * died between the commit and the publish, the broker lost the message, or the queue was purged). A QUEUED demo
     * may then be queued for import again, and a STORED one announced for parsing again. It is far longer than a
     * normal import, which touches the row when it starts, and than a normal wait for the parser. A demo that only
     * waits behind a long backlog is announced again too, which does no harm: the parser discards a message whose
     * demo is no longer STORED, and a parse that the touch has outdated is dropped and done again from the new
     * message.
     */
    static final Duration STALE_AFTER = Duration.ofMinutes(10);

    private final DemoRepository demos;
    private final MatchRepository matches;
    private final Clock clock;

    public DemoPersistence(DemoRepository demos, MatchRepository matches, Clock clock) {
        this.demos = demos;
        this.matches = matches;
        this.clock = clock;
    }

    /** The message the caller of {@link #queue} has to publish once the transaction has committed. */
    public enum Publish {
        /** The demo is reported as it is; there is nothing to send. */
        NOTHING,
        /** This very call created the demo or moved it back to QUEUED: send {@code demo.import}. */
        IMPORT,
        /** The demo is STORED and its {@code demo.parse} message looks lost: send {@code demo.parse} again. */
        PARSE
    }

    /**
     * What {@link #queue} found or did. {@code publish} says which message, if any, has to be sent for the demo; of
     * several concurrent requests for the same demo at most one gets anything but {@link Publish#NOTHING}.
     */
    public record Queued(Demo demo, Publish publish) {
    }

    /** The demo an import worker has taken over; {@code faceitMatchId} is the match it belongs to, as stored. */
    public record ImportClaim(long demoId, String faceitMatchId) {
    }

    /** A demo whose file is in storage, with what the {@code demo.parse} message about it has to say. */
    public record StoredDemo(long demoId, String faceitMatchId, String storageKey) {
    }

    /**
     * Finds the demo of a stored match or creates it as QUEUED. A FAILED demo goes back to QUEUED, and so does a
     * QUEUED one that has been untouched for {@link #STALE_AFTER}. A STORED demo that has a storage key and has been
     * untouched that long is touched and reported as one to announce on {@code demo.parse} again, because its
     * message looks lost; a STORED demo without a storage key (the retention job has removed its file) is left as it
     * is, and so is a demo in any other status. An existing row is read with a lock, so of several requests that
     * revive the same demo exactly one gets a {@link Publish} other than {@link Publish#NOTHING}.
     *
     * @param demoUrlAvailable whether FACEIT has a demo URL for the match; without one nothing can be queued for
     *        import. A STORED demo is announced without one: nothing is downloaded for it.
     * @param beforeQueued runs in this transaction when the request is about to queue something (the result will be
     *        {@link Publish#IMPORT} or {@link Publish#PARSE}) and before anything is written, and never otherwise. It
     *        stops the request by throwing: nothing is written then. This is where a limit per day counts the request.
     * @return empty when the demo would have to be queued for import but cannot be, because there is no demo URL;
     *         nothing is written then
     */
    @Transactional
    public Optional<Queued> queue(long matchRowId, boolean demoUrlAvailable, Runnable beforeQueued) {
        Demo existing = demos.findByMatchIdForUpdate(matchRowId).orElse(null);
        if (existing == null) {
            if (!demoUrlAvailable) {
                return Optional.empty();
            }
            Match match = matches.findById(matchRowId)
                    .orElseThrow(() -> new IllegalStateException("Match " + matchRowId + " is not stored"));
            beforeQueued.run();
            return Optional.of(new Queued(demos.save(new Demo(match)), Publish.IMPORT));
        }
        if (isStaleStored(existing)) {
            beforeQueued.run();
            // Touched under the lock, so that the next request finds the demo fresh and sends nothing.
            existing.touch();
            return Optional.of(new Queued(demos.saveAndFlush(existing), Publish.PARSE));
        }
        boolean failed = existing.getStatus() == DemoStatus.FAILED;
        if (!failed && !isStaleQueued(existing)) {
            return Optional.of(new Queued(existing, Publish.NOTHING));
        }
        if (!demoUrlAvailable) {
            return Optional.empty();
        }
        beforeQueued.run();
        if (failed) {
            existing.transitionTo(DemoStatus.QUEUED);
        } else {
            existing.touch();
        }
        return Optional.of(new Queued(demos.saveAndFlush(existing), Publish.IMPORT));
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
     * The demo, if it is STORED: what an import message that finds the demo already stored needs to announce it
     * again.
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
        return failIfStatus(demoId, expected, error, null);
    }

    /**
     * Like {@link #failIfStatus(long, DemoStatus, String)} for a reason that has a code a page can translate (see
     * {@link DemoErrorCode}); a null code is a reason that has none.
     */
    @Transactional
    public boolean failIfStatus(long demoId, DemoStatus expected, String error, DemoErrorCode errorCode) {
        Demo demo = demos.findByIdForUpdate(demoId).orElse(null);
        if (demo == null || demo.getStatus() != expected) {
            return false;
        }
        demo.fail(error, errorCode);
        demos.saveAndFlush(demo);
        return true;
    }

    /**
     * Records that the analysis of the demo failed for good (its {@code demo.parsed} message was dead-lettered) or
     * cannot be done at all (its facts have no round roster, which the analysis itself reports). The
     * demo is not FAILED: its facts are intact and the analysis can be started again, so a PARSED demo stays PARSED and
     * only gets {@code error} and, when the reason has one, {@code errorCode}. A demo in any other status is left as it is, an ANALYZED one included: it keeps the
     * results of its earlier analysis, and a demo that was uploaded again is on its way to a new parse. The check and
     * the update happen under the row lock. {@code updated_at} keeps its value (see {@link DemoRepository#noteError}),
     * so an analysis that is running does not take the error for a new upload or parse and drop its result.
     *
     * @return whether the error was recorded, that is, whether the demo is PARSED
     */
    @Transactional
    public boolean noteAnalysisFailure(long demoId, String error, DemoErrorCode errorCode) {
        Demo demo = demos.findByIdForUpdate(demoId).orElse(null);
        if (demo == null || demo.getStatus() != DemoStatus.PARSED) {
            return false;
        }
        demos.noteError(demoId, error, errorCode);
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
        return demo.getStatus() == DemoStatus.QUEUED && untouchedForStaleWindow(demo);
    }

    /** A STORED demo is announced again only if it has a file for the parser to read. */
    private boolean isStaleStored(Demo demo) {
        return demo.getStatus() == DemoStatus.STORED && demo.getStorageKey() != null && untouchedForStaleWindow(demo);
    }

    private boolean untouchedForStaleWindow(Demo demo) {
        return demo.getUpdatedAt().isBefore(clock.instant().minus(STALE_AFTER));
    }
}
