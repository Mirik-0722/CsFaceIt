package io.csfaceit.backend.demo;

import io.csfaceit.backend.auth.Access;
import io.csfaceit.backend.auth.Actor;
import io.csfaceit.backend.auth.ForbiddenException;
import io.csfaceit.backend.common.api.BadRequestException;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.demo.DemoPersistence.Queued;
import io.csfaceit.backend.demo.dto.DemoResponse;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.FaceitNotFoundException;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.match.MatchService;
import io.csfaceit.backend.messaging.DemoImportWorker;
import io.csfaceit.backend.messaging.DemoMessages;
import io.csfaceit.backend.messaging.DemoMessages.DemoImportRequested;
import io.csfaceit.backend.messaging.DemoMessages.DemoParsed;
import io.csfaceit.backend.messaging.DemoMetrics;
import io.csfaceit.backend.messaging.DemoStoredPublisher;
import io.csfaceit.backend.storage.StorageService;
import java.io.EOFException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.function.Supplier;
import java.util.zip.ZipException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.AmqpTemplate;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/**
 * Starts and reports the import of a match's demo, takes a demo that is uploaded by hand and asks for the analysis
 * of a parsed demo to be done again. Like
 * {@link MatchService} it opens no transaction itself: FACEIT and the storage are called with none open, the database
 * writes are the transactions of {@link DemoPersistence}, and the RabbitMQ message goes out only after they have
 * committed. Before a demo can be queued for parsing, the SteamIDs of the match's roster are stored
 * ({@link RosterSteamIdMapper}): the parser knows the players by SteamID only.
 *
 * <p>Each of the three requests is made by an {@link Actor}, and the first thing it does is ask {@link Access} whether
 * the actor may: the admin key and an administrator always, a user only for a match they played. The roster is FACEIT's
 * answer for the match (the cached gateway). When FACEIT cannot be asked and has no cached answer, the request of a
 * user fails with the answer of a FACEIT that is unavailable, before anything is stored: a roster that cannot be read
 * lets nobody in.
 */
@Service
public class DemoService {

    private static final String DEMO_NOT_FOUND = "DEMO_NOT_FOUND";
    private static final String DEMO_URL_UNAVAILABLE = "DEMO_URL_UNAVAILABLE";
    private static final String DEMO_NOT_PARSED = "DEMO_NOT_PARSED";
    private static final String MATCH_NOT_FOUND = "MATCH_NOT_FOUND";

    private static final Logger log = LoggerFactory.getLogger(DemoService.class);

    private final MatchService matchService;
    private final MatchRepository matches;
    private final DemoRepository demos;
    private final DemoPersistence persistence;
    private final AmqpTemplate amqp;
    private final FaceitGateway faceit;
    private final RosterSteamIdMapper rosterSteamIds;
    private final StorageService storage;
    private final DemoStoredPublisher storedPublisher;
    private final DemoUploadProperties uploadProperties;
    private final DemoMetrics metrics;
    private final Access access;

    public DemoService(MatchService matchService, MatchRepository matches, DemoRepository demos,
                       DemoPersistence persistence, AmqpTemplate amqp, FaceitGateway faceit,
                       RosterSteamIdMapper rosterSteamIds, StorageService storage, DemoStoredPublisher storedPublisher,
                       DemoUploadProperties uploadProperties, DemoMetrics metrics, Access access) {
        this.matchService = matchService;
        this.matches = matches;
        this.demos = demos;
        this.persistence = persistence;
        this.amqp = amqp;
        this.faceit = faceit;
        this.rosterSteamIds = rosterSteamIds;
        this.storage = storage;
        this.storedPublisher = storedPublisher;
        this.uploadProperties = uploadProperties;
        this.metrics = metrics;
        this.access = access;
    }

    /**
     * Queues the import of the match's demo. The match is loaded from FACEIT and stored first (this also gives the
     * demo URL), then the {@code demos} row is created, or revived when its import FAILED or its message was lost
     * (it has been QUEUED for a long time without anything happening), and the {@code demo.import} message is
     * published once that row is committed. A STORED demo that has been untouched for as long (the parser has not
     * taken it, so its {@code demo.parse} message looks lost) is announced on {@code demo.parse} again, also without
     * a demo URL, and answered as it is: STORED. A demo that is QUEUED or STORED only recently, or further along, is
     * reported as it is, without a message, and without needing a demo URL. Repeating the request, also in parallel,
     * therefore leaves one row and sends one message. The SteamIDs of the roster are stored first, so that they are
     * in place long before the stored demo reaches the parser.
     *
     * @param actor who asks; a user has to be in the roster of the match
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_IN_MATCH}: the user did not play the match
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match
     * @throws ConflictException {@code DEMO_URL_UNAVAILABLE}: the demo would have to be downloaded, but FACEIT has
     *         no demo for the match (yet)
     */
    public DemoResponse requestImport(Actor actor, String faceitMatchId) {
        requireMember(actor, faceitMatchId);
        String demoUrl = matchService.getMatch(faceitMatchId).demoUrl();
        boolean demoUrlAvailable = demoUrl != null && !demoUrl.isBlank();
        long matchRowId = mapRosterSteamIds(faceitMatchId);

        Queued queued = persistWithRetry("demo of match " + faceitMatchId,
                () -> persistence.queue(matchRowId, demoUrlAvailable))
                .orElseThrow(() -> new ConflictException(DEMO_URL_UNAVAILABLE,
                        "FACEIT has no demo for match " + faceitMatchId));
        Demo demo = queued.demo();
        switch (queued.publish()) {
            case IMPORT -> publishImport(demo.getId(), faceitMatchId, demoUrl);
            case PARSE -> publishParseAgain(demo, faceitMatchId);
            case NOTHING -> {
                // The demo is reported as it is.
            }
        }
        return toResponse(faceitMatchId, demo);
    }

    /**
     * Takes the demo file of the match from the caller instead of FACEIT. The file is stored as zstd whatever it came
     * as (raw, gzip or zstd), under the key the import worker uses, and the demo becomes STORED and is announced on
     * {@code demo.parse} once that is committed. A manual upload stores from any status, so it also repairs a FAILED
     * import and, deliberately, parses a PARSED or ANALYZED demo again. An import that is still downloading never
     * overwrites the demo row afterwards (the worker checks that the demo is still QUEUED before it stores its file,
     * and {@link DemoPersistence#markStored} needs it to be QUEUED). The uploaded object is less safe: the import's
     * file replaces it when the import's check ran before the upload committed and the import's {@code put} ran
     * after the upload's own {@code put} (see {@link DemoPersistence#restore}). The match is loaded from FACEIT and
     * stored first, and its roster's SteamIDs are mapped, before the file is looked at. Every temporary file is
     * deleted, whatever happens.
     *
     * <p>That is what the admin key and an administrator do. A user has to be in the roster of the match, and cannot
     * replace a demo that is PARSED or ANALYZED: it holds the statistics and the highlights of all ten players. Both
     * are asked before the file is read ({@link #requireUploadAllowed}, which the controller has called already, before
     * it received the file, and which is called here again so that no caller can leave it out). Receiving and
     * normalizing a large file takes a while, so the status is looked at once more just before the file goes to the
     * storage: a demo that became PARSED in the meantime is not replaced. The looks take no lock, because the file
     * goes under the key the parsed demo has and cannot be taken back; what is left is the moment between the last
     * look and the {@code put}, in which a demo that becomes PARSED is parsed again from the user's file, which the
     * analysis then checks against the roster like any other.
     *
     * @param actor who uploads
     * @param content the file, already known to be non-empty and to have a demo's file name; it is read once and not
     *        closed here
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_IN_MATCH}: the user did not play the match
     * @throws ConflictException {@code DEMO_ALREADY_PARSED}: a user uploads over a demo that has been parsed
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match
     * @throws BadRequestException the file is a corrupt gzip archive
     * @throws MaxUploadSizeExceededException the file, or what it expands to, is larger than the allowed size
     */
    public DemoResponse upload(Actor actor, String faceitMatchId, InputStream content) {
        requireUploadAllowed(actor, faceitMatchId);
        matchService.getMatch(faceitMatchId);
        long matchRowId = mapRosterSteamIds(faceitMatchId);

        String storageKey = DemoImportWorker.storageKey(faceitMatchId);
        storeUpload(content, storageKey, () -> requireDemoReplaceable(actor, faceitMatchId));

        Demo demo = persistWithRetry("demo of match " + faceitMatchId,
                () -> persistence.restore(matchRowId, storageKey));
        log.info("Stored the uploaded demo {} of match {} as {}", demo.getId(), faceitMatchId, storageKey);
        storedPublisher.publish(demo.getId(), faceitMatchId, storageKey);
        return toResponse(faceitMatchId, demo);
    }

    /**
     * Whether the actor may upload a file as the demo of the match, asked before a byte of the file is received: a
     * user has to be in the roster of the match and cannot replace a demo that has been parsed. Nothing is written.
     * The controller calls it before it reads the request's body, so that a caller who is refused has sent the server
     * nothing to keep.
     *
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_IN_MATCH}: the user did not play the match
     * @throws ConflictException {@code DEMO_ALREADY_PARSED}: a user uploads over a demo that has been parsed
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match (asked for a user only; for
     *         the key and an administrator {@link #upload} finds that out)
     */
    public void requireUploadAllowed(Actor actor, String faceitMatchId) {
        requireMember(actor, faceitMatchId);
        requireDemoReplaceable(actor, faceitMatchId);
    }

    private void requireDemoReplaceable(Actor actor, String faceitMatchId) {
        access.requireDemoReplaceable(actor,
                demos.findByMatchFaceitMatchId(faceitMatchId).map(Demo::getStatus).orElse(null));
    }

    /**
     * Asks for the analysis of the match's parsed demo to be done again, by announcing the demo on {@code demo.parsed}
     * as the parser does when it has parsed it. The facts the parser wrote are in the database, so the demo file is
     * not needed, and nothing is written here: the listener analyzes the demo, and the answer is the demo as it is now,
     * so a PARSED demo (the analysis failed, or has not been done yet) is still PARSED in it. FACEIT is asked for the
     * roster of the match (a cached answer) only for a PARSED demo, whose players are compared with it before the
     * analysis; an ANALYZED demo has passed that check and is analyzed again without FACEIT. Repeating the request is
     * harmless, the analysis is idempotent.
     *
     * <p>A user has to be in the roster of the match (FACEIT's cached answer is asked for that) and can ask only for
     * the analysis that is missing: while the demo is PARSED. Doing an analysis again is the admin key's and an
     * administrator's, for whom FACEIT is not asked here at all.
     *
     * @param actor who asks
     * @throws NotFoundException {@code DEMO_NOT_FOUND}: the match has no demo
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_IN_MATCH}: the user did not play the match
     * @throws ConflictException {@code DEMO_NOT_PARSED}: the demo is not PARSED or ANALYZED, so there are no facts to
     *         analyze (yet, or any more); {@code DEMO_ALREADY_ANALYZED}: a user asks for an analysis that is done
     */
    public DemoResponse requestAnalysis(Actor actor, String faceitMatchId) {
        Demo demo = demos.findByMatchFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new NotFoundException(DEMO_NOT_FOUND, "Demo not found for match: " + faceitMatchId));
        requireMember(actor, faceitMatchId);
        if (demo.getStatus() != DemoStatus.PARSED && demo.getStatus() != DemoStatus.ANALYZED) {
            throw new ConflictException(DEMO_NOT_PARSED,
                    "The demo of match " + faceitMatchId + " is " + demo.getStatus() + ", not parsed");
        }
        access.requireDemoAwaitingAnalysis(actor, demo.getStatus());
        amqp.convertAndSend(DemoMessages.EXCHANGE, DemoMessages.Q_PARSED, new DemoParsed(demo.getId(), faceitMatchId));
        log.info("Announced demo {} of match {} on {} to have it analyzed again", demo.getId(), faceitMatchId,
                DemoMessages.Q_PARSED);
        return toResponse(faceitMatchId, demo);
    }

    /** The stored state of the match's demo. */
    public DemoResponse get(String faceitMatchId) {
        Demo demo = demos.findByMatchFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new NotFoundException(DEMO_NOT_FOUND, "Demo not found for match: " + faceitMatchId));
        return toResponse(faceitMatchId, demo);
    }

    /**
     * Asks {@link Access} whether the actor played the match. FACEIT is asked for the roster only when the rule needs
     * it (never for the admin key or an administrator), and nothing has been stored or written when this refuses.
     *
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match
     * @throws io.csfaceit.backend.faceit.FaceitUnavailableException FACEIT cannot be asked and has no cached answer
     */
    private void requireMember(Actor actor, String faceitMatchId) {
        access.requireMatchMember(actor, () -> roster(faceitMatchId));
    }

    private FaceitMatch roster(String faceitMatchId) {
        try {
            return faceit.getMatch(faceitMatchId);
        } catch (FaceitNotFoundException e) {
            throw new NotFoundException(MATCH_NOT_FOUND, "Match not found: " + faceitMatchId);
        }
    }

    /**
     * Stores the SteamIDs of the roster of the (stored) match. FACEIT's answer comes from the cache that
     * {@code matchService.getMatch} has just filled.
     *
     * @return the id of the match's row
     */
    private long mapRosterSteamIds(String faceitMatchId) {
        rosterSteamIds.apply(faceit.getMatch(faceitMatchId));
        return matches.findByFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new IllegalStateException("Match " + faceitMatchId + " is not stored"))
                .getId();
    }

    /**
     * Copies the upload to a temporary file, normalizes it to zstd and puts it in storage. {@code beforePut} runs when
     * the file is ready and nothing has been put yet, and stops the upload by throwing; the temporary files go either
     * way.
     */
    private void storeUpload(InputStream content, String storageKey, Runnable beforePut) {
        Path received = null;
        Path normalized = null;
        try {
            received = DemoFiles.receive(content, uploadProperties.maxSize());
            normalized = DemoFiles.normalize(received, uploadProperties.maxSize());
            beforePut.run();
            storage.put(storageKey, normalized);
        } catch (DemoDownloadRejectedException e) {
            throw new MaxUploadSizeExceededException(uploadProperties.maxSize().toBytes(), e);
        } catch (DemoDownloadException e) {
            if (e.getCause() instanceof ZipException || e.getCause() instanceof EOFException) {
                throw new BadRequestException("The file is not a valid gzip archive");
            }
            throw e;
        } finally {
            DemoFiles.deleteQuietly(received);
            DemoFiles.deleteQuietly(normalized);
        }
    }

    /**
     * Publishes the import request. When that fails the row is already committed as QUEUED with nothing to process
     * it, so it is marked FAILED (the next import request queues it again), counted as a failed import, and the
     * failure reaches the caller.
     */
    private void publishImport(long demoId, String faceitMatchId, String demoUrl) {
        try {
            amqp.convertAndSend(DemoMessages.EXCHANGE, DemoMessages.Q_IMPORT,
                    new DemoImportRequested(demoId, faceitMatchId, demoUrl));
        } catch (RuntimeException e) {
            log.error("Could not publish {} for demo {} of match {}, marking the demo FAILED", DemoMessages.Q_IMPORT,
                    demoId, faceitMatchId, e);
            try {
                if (persistence.failUnpublished(demoId)) {
                    metrics.failed(DemoMetrics.STAGE_IMPORT);
                }
            } catch (RuntimeException markFailure) {
                log.error("Could not mark demo {} FAILED; it stays QUEUED without a message", demoId, markFailure);
                e.addSuppressed(markFailure);
            }
            throw e;
        }
    }

    /**
     * Announces a STORED demo whose {@code demo.parse} message looks lost ({@link DemoPersistence#queue} has touched
     * it, so that no other request sends the message too). Like every publish this follows the commit. A failed
     * publish is handled by {@link DemoStoredPublisher}: the demo is marked FAILED and the failure reaches the caller.
     */
    private void publishParseAgain(Demo demo, String faceitMatchId) {
        log.warn("Demo {} of match {} has been STORED for a long time without being parsed; publishing {} again",
                demo.getId(), faceitMatchId, DemoMessages.Q_PARSE);
        storedPublisher.publish(demo.getId(), faceitMatchId, demo.getStorageKey());
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
        return new DemoResponse(demo.getId(), faceitMatchId, demo.getStatus(), demo.getError(), demo.getErrorCode(),
                demo.getUpdatedAt());
    }
}
