package io.csfaceit.backend.messaging;

import io.csfaceit.backend.demo.DemoDownloadRejectedException;
import io.csfaceit.backend.demo.DemoDownloader;
import io.csfaceit.backend.demo.DemoPersistence;
import io.csfaceit.backend.demo.DemoPersistence.ImportClaim;
import io.csfaceit.backend.demo.DemoPersistence.StoredDemo;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.demo.FaceitDownloadsApi;
import io.csfaceit.backend.demo.PastedLinks;
import io.csfaceit.backend.messaging.DemoMessages.DemoImportRequested;
import io.csfaceit.backend.storage.StorageService;
import io.micrometer.core.instrument.Timer;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * Imports the demos named on {@code demo.import}: downloads the file, stores it as zstd, marks the demo STORED and
 * announces it on {@code demo.parse}. It holds no transaction while it downloads or stores: each status change is a
 * short transaction of {@link DemoPersistence}, and {@code demo.parse} is published only after the STORED commit.
 *
 * <p>The file is had in one of two ways. The {@code demo_url} of a FACEIT match is a private cloud address, and FACEIT
 * gives the file only through its Downloads API, so with a token ({@code FACEIT_DOWNLOADS_TOKEN}) the worker asks
 * {@link FaceitDownloadsApi} for a signed address and downloads from that. Without a token it downloads
 * {@code demo_url} itself, which works for a host that really serves the file (the fake FACEIT does) and otherwise ends
 * in the rejection {@code DOWNLOAD_NEEDS_ACCESS}. A link that a player pasted for the demo comes before both: it is
 * not in the message but in {@link PastedLinks}, and is downloaded through {@link DemoDownloader#downloadLink}, which
 * checks every address it leads to. In every way a refusal that asking again cannot change is a
 * {@link DemoDownloadRejectedException}: the demo is FAILED at once with its reason, and the message is not retried.
 *
 * <p>Delivery is at least once, so the same message can arrive twice; the first thing done is to claim the demo,
 * and a demo that is not QUEUED (already stored, failed, or further along) is left alone, with one exception: the
 * process can die after the STORED commit and before {@code demo.parse} is published, and the broker then delivers
 * the import message again. An import message that finds the demo STORED, redelivered or not, publishes
 * {@code demo.parse} again, so that the demo does not wait for a parser forever. A second {@code demo.parse} does no
 * harm: the parser discards a message whose demo is not STORED, and writes only if the demo is still as it was when
 * its work began. A failure that may go away is thrown, so that the listener container tries the message again and
 * finally dead-letters it, which marks the demo FAILED (see {@link DemoDlqListener}).
 */
@Component
public class DemoImportWorker {

    /**
     * The reason a demo that was queued with a pasted link is FAILED when the link is gone (and FACEIT has no address
     * of its own for it). Shared with the sweep that republishes lost import messages, which ends such a demo the same
     * way without going through the queue.
     */
    public static final String PASTED_LINK_GONE = "Demo download rejected: the pasted demo link is no longer known. "
            + "Paste it again, or upload the .dem manually.";

    private static final Logger log = LoggerFactory.getLogger(DemoImportWorker.class);

    private final DemoPersistence persistence;
    private final DemoDownloader downloader;
    private final FaceitDownloadsApi downloadsApi;
    private final StorageService storage;
    private final DemoStoredPublisher publisher;
    private final DemoMetrics metrics;
    private final PastedLinks pastedLinks;

    public DemoImportWorker(DemoPersistence persistence, DemoDownloader downloader, FaceitDownloadsApi downloadsApi,
                            StorageService storage, DemoStoredPublisher publisher, DemoMetrics metrics,
                            PastedLinks pastedLinks) {
        this.pastedLinks = pastedLinks;
        this.persistence = persistence;
        this.downloader = downloader;
        this.downloadsApi = downloadsApi;
        this.storage = storage;
        this.publisher = publisher;
        this.metrics = metrics;
    }

    /** The storage key of a match's demo; the file under it is always zstd. */
    public static String storageKey(String faceitMatchId) {
        return "demos/" + faceitMatchId + ".dem.zst";
    }

    /**
     * Two consumers, so that the automatic sync of FACEIT demos (a few demos at once) does not leave a demo that a
     * player asked for by hand waiting behind a long download. Two messages for the same demo cannot run side by side:
     * {@link DemoPersistence#claimForImport} takes the row's lock and only a QUEUED demo is imported.
     */
    @RabbitListener(queues = DemoMessages.Q_IMPORT, concurrency = "2")
    public void onImportRequested(DemoImportRequested message) {
        long demoId = message.demoId();
        Optional<ImportClaim> claim = persistence.claimForImport(demoId);
        if (claim.isEmpty()) {
            announceIfStored(demoId);
            return;
        }
        // The import stage is timed from the claim to the end of the work, whatever the outcome; a message that was
        // ignored above is not an import.
        Timer.Sample sample = metrics.startImport();
        try {
            importDemo(message, claim.get().faceitMatchId());
        } finally {
            metrics.importFinished(sample);
        }
    }

    /** Downloads, stores and announces the demo this worker has claimed. */
    private void importDemo(DemoImportRequested message, String faceitMatchId) {
        long demoId = message.demoId();
        String storageKey = storageKey(faceitMatchId);
        Optional<URI> link = pastedLinks.take(demoId);
        if (link.isPresent()) {
            log.info("Importing the demo {} of match {} from a pasted link to {}", demoId, faceitMatchId,
                    link.get().getHost());
        } else {
            log.info("Importing the demo {} of match {}", demoId, faceitMatchId);
            if (message.demoUrl() == null || message.demoUrl().isBlank()) {
                // Only a pasted link queues a demo without a FACEIT address, so the link has expired or was lost.
                log.info("The demo {} of match {} was queued with a pasted link that is gone", demoId, faceitMatchId);
            }
        }

        Path file = null;
        try {
            file = link.isPresent() ? downloader.downloadLink(link.get()) : fetch(message.demoUrl());
            // The download can take minutes, and a manual upload may have stored the demo meanwhile: its file is under
            // the same key and must stay. The check is not airtight: an upload that commits after it can still have
            // its object replaced by the put below (DemoPersistence#restore has the exact order), though never the
            // demo row, which markStored below leaves alone.
            if (!persistence.isQueued(demoId)) {
                log.warn("Demo {} of match {} is no longer QUEUED; dropping the downloaded file", demoId,
                        faceitMatchId);
                return;
            }
            storage.put(storageKey, file);
        } catch (DemoDownloadRejectedException e) {
            log.warn("The download of demo {} of match {} was rejected: {}", demoId, faceitMatchId, e.getMessage());
            if (persistence.failIfStatus(demoId, DemoStatus.QUEUED, e.getMessage(), e.errorCode())) {
                metrics.failed(DemoMetrics.STAGE_IMPORT);
            }
            throw new AmqpRejectAndDontRequeueException(e.getMessage(), e);
        } catch (RuntimeException e) {
            // The message is tried again, and the next attempt needs the link as much as this one did. The worker cannot
            // see the attempt number, so after the last attempt the link stays until its time is up. A later import of
            // the demo may use it; it is checked again like any link, and its file was already checked for this match.
            link.ifPresent(uri -> pastedLinks.put(demoId, uri));
            throw e;
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
     * Downloads the demo of the match, through FACEIT's Downloads API when the site has a token for it, otherwise from
     * {@code demo_url} as it is. The signed address the API gives is used for this download only: it is not logged
     * (only its host is, by {@link FaceitDownloadsApi}), not stored and not part of any message.
     */
    private Path fetch(String demoUrl) {
        if (demoUrl == null || demoUrl.isBlank()) {
            // Queued for a link that is gone (the backend restarted, or the link waited too long) for a match FACEIT
            // has no demo address for.
            throw new DemoDownloadRejectedException(PASTED_LINK_GONE);
        }
        if (downloadsApi.isConfigured()) {
            return downloader.download(downloadsApi.signedAddress(demoUrl));
        }
        return downloader.downloadFaceitAddress(demoUrl);
    }

    /**
     * An import message for a demo that is no longer QUEUED: if the demo is STORED, the delivery that stored it most
     * likely died before it published {@code demo.parse}, or that message was lost since, so it is sent now. It may
     * then reach the parser twice, which delivery at least once allows anyway. A demo in any other status (FAILED,
     * or PARSED and further) needs nothing.
     */
    private void announceIfStored(long demoId) {
        Optional<StoredDemo> stored = persistence.findStored(demoId);
        if (stored.isEmpty()) {
            log.info("Ignoring {} for demo {}: it is not waiting for an import", DemoMessages.Q_IMPORT, demoId);
            return;
        }
        StoredDemo demo = stored.get();
        log.warn("The {} for demo {} found it STORED; publishing {} again", DemoMessages.Q_IMPORT, demoId,
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
