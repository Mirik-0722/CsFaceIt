package io.csfaceit.backend.messaging;

import io.csfaceit.backend.demo.DemoDownloadRejectedException;
import io.csfaceit.backend.demo.DemoDownloader;
import io.csfaceit.backend.demo.DemoPersistence;
import io.csfaceit.backend.demo.DemoPersistence.ImportClaim;
import io.csfaceit.backend.demo.DemoPersistence.StoredDemo;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.messaging.DemoMessages.DemoImportRequested;
import io.csfaceit.backend.storage.StorageService;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.support.AmqpHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

/**
 * Imports the demos named on {@code demo.import}: downloads the file, stores it as zstd, marks the demo STORED and
 * announces it on {@code demo.parse}. It holds no transaction while it downloads or stores: each status change is a
 * short transaction of {@link DemoPersistence}, and {@code demo.parse} is published only after the STORED commit.
 *
 * <p>Delivery is at least once, so the same message can arrive twice; the first thing done is to claim the demo,
 * and a demo that is not QUEUED (already stored, failed, or further along) is left alone, with one exception: the
 * process can die after the STORED commit and before {@code demo.parse} is published, and the broker then delivers
 * the import message again, flagged as redelivered. A redelivered message that finds the demo STORED publishes
 * {@code demo.parse} again, so that the demo does not wait for a parser forever. A failure that may go away is
 * thrown, so that the listener container tries the message again and finally dead-letters it, which marks the demo
 * FAILED (see {@link DemoDlqListener}).
 */
@Component
public class DemoImportWorker {

    private static final Logger log = LoggerFactory.getLogger(DemoImportWorker.class);

    private final DemoPersistence persistence;
    private final DemoDownloader downloader;
    private final StorageService storage;
    private final DemoStoredPublisher publisher;

    public DemoImportWorker(DemoPersistence persistence, DemoDownloader downloader, StorageService storage,
                            DemoStoredPublisher publisher) {
        this.persistence = persistence;
        this.downloader = downloader;
        this.storage = storage;
        this.publisher = publisher;
    }

    /** The storage key of a match's demo; the file under it is always zstd. */
    public static String storageKey(String faceitMatchId) {
        return "demos/" + faceitMatchId + ".dem.zst";
    }

    @RabbitListener(queues = DemoMessages.Q_IMPORT)
    public void onImportRequested(DemoImportRequested message,
                                  @Header(AmqpHeaders.REDELIVERED) boolean redelivered) {
        long demoId = message.demoId();
        Optional<ImportClaim> claim = persistence.claimForImport(demoId);
        if (claim.isEmpty()) {
            if (redelivered) {
                announceIfStored(demoId);
            } else {
                log.info("Ignoring {} for demo {}: it is not waiting for an import", DemoMessages.Q_IMPORT, demoId);
            }
            return;
        }
        String faceitMatchId = claim.get().faceitMatchId();
        String storageKey = storageKey(faceitMatchId);
        log.info("Importing the demo {} of match {}", demoId, faceitMatchId);

        Path file = null;
        try {
            file = downloader.download(message.demoUrl());
            // The download can take minutes, and a manual upload may have stored the demo meanwhile: its file is under
            // the same key and must stay. (An upload landing during the put itself is still possible, the demo then
            // stays as the upload left it, see markStored below.)
            if (!persistence.isQueued(demoId)) {
                log.warn("Demo {} of match {} is no longer QUEUED; dropping the downloaded file", demoId,
                        faceitMatchId);
                return;
            }
            storage.put(storageKey, file);
        } catch (DemoDownloadRejectedException e) {
            log.warn("The download of demo {} of match {} was rejected: {}", demoId, faceitMatchId, e.getMessage());
            persistence.failIfStatus(demoId, DemoStatus.QUEUED, e.getMessage());
            throw new AmqpRejectAndDontRequeueException(e.getMessage(), e);
        } finally {
            deleteQuietly(file);
        }

        if (!persistence.markStored(demoId, storageKey)) {
            log.warn("Demo {} of match {} was stored but is no longer QUEUED; not announcing it", demoId, faceitMatchId);
            return;
        }
        log.info("Stored demo {} of match {} as {}", demoId, faceitMatchId, storageKey);
        publishStored(demoId, faceitMatchId, storageKey);
    }

    /**
     * A redelivered import message for a demo that is no longer QUEUED: if the demo is STORED, the previous delivery
     * most likely died before it published {@code demo.parse}, so that message is sent now. It may then reach the
     * parser twice, which delivery at least once allows anyway. A demo in any other status (FAILED, or PARSED and
     * further) needs nothing.
     */
    private void announceIfStored(long demoId) {
        Optional<StoredDemo> stored = persistence.findStored(demoId);
        if (stored.isEmpty()) {
            log.info("Ignoring the redelivered {} for demo {}: it is not waiting for an import", DemoMessages.Q_IMPORT,
                    demoId);
            return;
        }
        StoredDemo demo = stored.get();
        log.warn("The redelivered {} for demo {} found it STORED; publishing {} again", DemoMessages.Q_IMPORT, demoId,
                DemoMessages.Q_PARSE);
        publishStored(demo.demoId(), demo.faceitMatchId(), demo.storageKey());
    }

    /** Publishes {@code demo.parse}; a failure is final for this message, the demo has been marked FAILED. */
    private void publishStored(long demoId, String faceitMatchId, String storageKey) {
        try {
            publisher.publish(demoId, faceitMatchId, storageKey);
        } catch (RuntimeException e) {
            throw new AmqpRejectAndDontRequeueException(DemoStoredPublisher.PARSE_PUBLISH_FAILED, e);
        }
    }

    private static void deleteQuietly(Path file) {
        if (file == null) {
            return;
        }
        try {
            Files.deleteIfExists(file);
        } catch (IOException e) {
            log.warn("Could not delete the temporary file {}: {}", file, e.toString());
        }
    }
}
