package io.csfaceit.backend.messaging;

import io.csfaceit.backend.demo.DemoDownloadRejectedException;
import io.csfaceit.backend.demo.DemoDownloader;
import io.csfaceit.backend.demo.DemoPersistence;
import io.csfaceit.backend.demo.DemoPersistence.ImportClaim;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.messaging.DemoMessages.DemoImportRequested;
import io.csfaceit.backend.messaging.DemoMessages.DemoStored;
import io.csfaceit.backend.storage.StorageService;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.AmqpTemplate;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * Imports the demos named on {@code demo.import}: downloads the file, stores it as zstd, marks the demo STORED and
 * announces it on {@code demo.parse}. It holds no transaction while it downloads or stores: each status change is a
 * short transaction of {@link DemoPersistence}, and {@code demo.parse} is published only after the STORED commit.
 *
 * <p>Delivery is at least once, so the same message can arrive twice; the first thing done is to claim the demo,
 * and a demo that is not QUEUED (already stored, failed, or further along) is left alone. A failure that may go away
 * is thrown, so that the listener container tries the message again and finally dead-letters it, which marks the
 * demo FAILED (see {@link DemoDlqListener}).
 */
@Component
public class DemoImportWorker {

    /** Stored in {@code demos.error} when the demo is stored but {@code demo.parse} could not be published. */
    static final String PARSE_PUBLISH_FAILED =
            "The demo was stored but could not be queued for parsing: the message broker is unavailable";

    private static final Logger log = LoggerFactory.getLogger(DemoImportWorker.class);

    private final DemoPersistence persistence;
    private final DemoDownloader downloader;
    private final StorageService storage;
    private final AmqpTemplate amqp;

    public DemoImportWorker(DemoPersistence persistence, DemoDownloader downloader, StorageService storage,
                            AmqpTemplate amqp) {
        this.persistence = persistence;
        this.downloader = downloader;
        this.storage = storage;
        this.amqp = amqp;
    }

    /** The storage key of a match's demo; the file under it is always zstd. */
    public static String storageKey(String faceitMatchId) {
        return "demos/" + faceitMatchId + ".dem.zst";
    }

    @RabbitListener(queues = DemoMessages.Q_IMPORT)
    public void onImportRequested(DemoImportRequested message) {
        long demoId = message.demoId();
        Optional<ImportClaim> claim = persistence.claimForImport(demoId);
        if (claim.isEmpty()) {
            log.info("Ignoring {} for demo {}: it is not waiting for an import", DemoMessages.Q_IMPORT, demoId);
            return;
        }
        String faceitMatchId = claim.get().faceitMatchId();
        String storageKey = storageKey(faceitMatchId);
        log.info("Importing the demo {} of match {}", demoId, faceitMatchId);

        Path file = null;
        try {
            file = downloader.download(message.demoUrl());
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
     * Publishes {@code demo.parse}. When that fails the demo is STORED with nobody to parse it, so it is marked FAILED
     * (a new import request queues it again) and the failure is thrown.
     */
    private void publishStored(long demoId, String faceitMatchId, String storageKey) {
        try {
            amqp.convertAndSend(DemoMessages.EXCHANGE, DemoMessages.Q_PARSE,
                    new DemoStored(demoId, faceitMatchId, storageKey));
        } catch (RuntimeException e) {
            log.error("Could not publish {} for demo {} of match {}, marking the demo FAILED", DemoMessages.Q_PARSE,
                    demoId, faceitMatchId, e);
            try {
                persistence.failIfStatus(demoId, DemoStatus.STORED, PARSE_PUBLISH_FAILED);
            } catch (RuntimeException markFailure) {
                log.error("Could not mark demo {} FAILED; it stays STORED without a parse message", demoId,
                        markFailure);
                e.addSuppressed(markFailure);
            }
            throw new AmqpRejectAndDontRequeueException(PARSE_PUBLISH_FAILED, e);
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
