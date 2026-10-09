package io.csfaceit.backend.demo;

import io.csfaceit.backend.common.api.BadRequestException;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.demo.DemoPersistence.Queued;
import io.csfaceit.backend.demo.dto.DemoResponse;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.match.MatchService;
import io.csfaceit.backend.messaging.DemoImportWorker;
import io.csfaceit.backend.messaging.DemoMessages;
import io.csfaceit.backend.messaging.DemoMessages.DemoImportRequested;
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
 * Starts and reports the import of a match's demo, and takes a demo that is uploaded by hand. Like
 * {@link MatchService} it opens no transaction itself: FACEIT and the storage are called with none open, the database
 * writes are the transactions of {@link DemoPersistence}, and the RabbitMQ message goes out only after they have
 * committed. Before a demo can be queued for parsing, the SteamIDs of the match's roster are stored
 * ({@link RosterSteamIdMapper}): the parser knows the players by SteamID only.
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
    private final FaceitGateway faceit;
    private final RosterSteamIdMapper rosterSteamIds;
    private final StorageService storage;
    private final DemoStoredPublisher storedPublisher;
    private final DemoUploadProperties uploadProperties;

    public DemoService(MatchService matchService, MatchRepository matches, DemoRepository demos,
                       DemoPersistence persistence, AmqpTemplate amqp, FaceitGateway faceit,
                       RosterSteamIdMapper rosterSteamIds, StorageService storage, DemoStoredPublisher storedPublisher,
                       DemoUploadProperties uploadProperties) {
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
    }

    /**
     * Queues the import of the match's demo. The match is loaded from FACEIT and stored first (this also gives the
     * demo URL), then the {@code demos} row is created, or revived when its import FAILED or its message was lost
     * (it has been QUEUED for a long time without anything happening), and the {@code demo.import} message is
     * published once that row is committed. A demo that is already QUEUED, recently, or further along is reported
     * as it is, without a message, and without needing a demo URL. Repeating the request, also in parallel,
     * therefore leaves one row and queues one message. The SteamIDs of the roster are stored first, so that they are
     * in place long before the stored demo reaches the parser.
     *
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match
     * @throws ConflictException {@code DEMO_URL_UNAVAILABLE}: the demo would have to be downloaded, but FACEIT has
     *         no demo for the match (yet)
     */
    public DemoResponse requestImport(String faceitMatchId) {
        String demoUrl = matchService.getMatch(faceitMatchId).demoUrl();
        boolean demoUrlAvailable = demoUrl != null && !demoUrl.isBlank();
        long matchRowId = mapRosterSteamIds(faceitMatchId);

        Queued queued = persistWithRetry("demo of match " + faceitMatchId,
                () -> persistence.queue(matchRowId, demoUrlAvailable))
                .orElseThrow(() -> new ConflictException(DEMO_URL_UNAVAILABLE,
                        "FACEIT has no demo for match " + faceitMatchId));
        if (queued.publish()) {
            publishImport(queued.demo().getId(), faceitMatchId, demoUrl);
        }
        return toResponse(faceitMatchId, queued.demo());
    }

    /**
     * Takes the demo file of the match from the caller instead of FACEIT. The file is stored as zstd whatever it came
     * as (raw, gzip or zstd), under the key the import worker uses, and the demo becomes STORED and is announced on
     * {@code demo.parse} once that is committed. A manual upload stores from any status, so it also repairs a FAILED
     * import and, deliberately, parses a PARSED or ANALYZED demo again; an import that is still downloading does
     * not replace the upload afterwards (the worker checks that the demo is still QUEUED before it stores its file,
     * and {@link DemoPersistence#markStored} needs it to be QUEUED). The match is loaded from FACEIT and stored
     * first, and its roster's SteamIDs are mapped, before the file is looked at. Every temporary file is deleted,
     * whatever happens.
     *
     * @param content the file, already known to be non-empty and to have a demo's file name; it is read once and not
     *        closed here
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match
     * @throws BadRequestException the file is a corrupt gzip archive
     * @throws MaxUploadSizeExceededException the file, or what it expands to, is larger than the allowed size
     */
    public DemoResponse upload(String faceitMatchId, InputStream content) {
        matchService.getMatch(faceitMatchId);
        long matchRowId = mapRosterSteamIds(faceitMatchId);

        String storageKey = DemoImportWorker.storageKey(faceitMatchId);
        storeUpload(content, storageKey);

        Demo demo = persistWithRetry("demo of match " + faceitMatchId,
                () -> persistence.restore(matchRowId, storageKey));
        log.info("Stored the uploaded demo {} of match {} as {}", demo.getId(), faceitMatchId, storageKey);
        storedPublisher.publish(demo.getId(), faceitMatchId, storageKey);
        return toResponse(faceitMatchId, demo);
    }

    /** The stored state of the match's demo. */
    public DemoResponse get(String faceitMatchId) {
        Demo demo = demos.findByMatchFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new NotFoundException(DEMO_NOT_FOUND, "Demo not found for match: " + faceitMatchId));
        return toResponse(faceitMatchId, demo);
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

    /** Copies the upload to a temporary file, normalizes it to zstd and puts it in storage. */
    private void storeUpload(InputStream content, String storageKey) {
        Path received = null;
        Path normalized = null;
        try {
            received = DemoFiles.receive(content, uploadProperties.maxSize());
            normalized = DemoFiles.normalize(received, uploadProperties.maxSize());
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
