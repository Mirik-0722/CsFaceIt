package io.csfaceit.backend.clip.worker;

import io.csfaceit.backend.clip.ClipProperties;
import io.csfaceit.backend.clip.ClipQuality;
import io.csfaceit.backend.clip.ClipStatus;
import io.csfaceit.backend.clip.worker.WorkerPersistence.ClaimedClip;
import io.csfaceit.backend.clip.worker.WorkerPersistence.Ended;
import io.csfaceit.backend.clip.worker.WorkerPersistence.Fate;
import io.csfaceit.backend.clip.worker.WorkerPersistence.Turn;
import io.csfaceit.backend.clip.worker.dto.ClaimRequest;
import io.csfaceit.backend.clip.worker.dto.CompleteRequest;
import io.csfaceit.backend.clip.worker.dto.FailRequest;
import io.csfaceit.backend.clip.worker.dto.HeartbeatRequest;
import io.csfaceit.backend.clip.worker.dto.ProgressRequest;
import io.csfaceit.backend.clip.worker.dto.WorkerJob;
import io.csfaceit.backend.common.api.BadRequestException;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.GoneException;
import io.csfaceit.backend.storage.StorageException;
import io.csfaceit.backend.storage.StorageService;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.Set;
import java.util.function.LongConsumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/**
 * What a recorder asks of the backend: to be given a queued clip, to report on it, to download the demo, to upload the
 * video and the thumbnail, and to finish or give up the clip. Like {@code DemoService} it opens no transaction itself:
 * the storage is called with none open, and the short database steps are the transactions of
 * {@link WorkerPersistence}. A file is never held in memory: the demo is streamed out of the storage, an upload is
 * streamed into a temporary file (counting its bytes) and from there into the storage, and the temporary file is
 * deleted whatever happens.
 *
 * <p>Every request about a clip carries the name of the recorder, and the clip must be held by it. A clip that is
 * not (it was taken back from a recorder that went silent, finished, failed, or deleted, or never existed) is
 * answered with one signal, {@code 409 CLIP_NOT_CLAIMED}, which means to the recorder that it has to stop working on
 * the clip.
 */
@Service
public class WorkerService {

    static final String DEMO_NOT_AVAILABLE = "DEMO_NOT_AVAILABLE";

    /** What is stored when a recorder gives up a clip and says nothing of why. */
    static final String NO_REASON = "The recorder gave no reason";

    /** The most of a recorder's error text that is kept; a longer text is cut. */
    static final int MAX_ERROR_LENGTH = 2000;

    /** The most of an error text that goes to the log, on one line. */
    private static final int LOGGED_ERROR_LENGTH = 300;

    private static final String CUT_MARK = "...";
    private static final int COPY_BUFFER_SIZE = 64 * 1024;

    private static final Logger log = LoggerFactory.getLogger(WorkerService.class);

    /** The demo of a clip, ready to be sent: its size, and the stream to read it from, which the caller closes. */
    public record DemoDownload(long sizeBytes, InputStream content) {
    }

    private final WorkerPersistence persistence;
    private final StorageService storage;
    private final ClipProperties properties;

    public WorkerService(WorkerPersistence persistence, StorageService storage, ClipProperties properties) {
        this.persistence = persistence;
        this.storage = storage;
        this.properties = properties;
    }

    /** Where the video of a clip is kept in the storage. */
    public static String videoKey(long clipId) {
        return "clips/" + clipId + ".mp4";
    }

    /** Where the thumbnail of a clip is kept in the storage. */
    public static String thumbnailKey(long clipId) {
        return "clips/" + clipId + ".jpg";
    }

    /**
     * Gives the recorder the oldest queued clip of the qualities it can record, which becomes {@code RECORDING}, or
     * nothing when none is waiting. Each turn takes one clip in its own short transaction; one that cannot be recorded
     * (its demo file is gone, its player has no Steam ID) is failed there and the next is taken, so the loop ends: a
     * failed clip is not queued any more. The size of the demo file is asked of the storage after the claim has
     * committed. A clip whose file is not there although the row names it is failed too, and the next is taken.
     */
    public Optional<WorkerJob> claim(ClaimRequest request) {
        String worker = request.worker();
        Set<ClipQuality> qualities = qualitiesOf(request.qualities());
        while (true) {
            switch (persistence.claimNext(worker, request.version(), request.mode(), qualities)) {
                case Turn.NothingWaiting nothing -> {
                    return Optional.empty();
                }
                case Turn.Rejected rejected ->
                    log.info("Failed clip {} instead of giving it to {}: {}", rejected.clipId(), worker,
                            rejected.reason());
                case Turn.Taken taken -> {
                    Optional<WorkerJob> job = jobOf(taken.clip(), worker);
                    if (job.isPresent()) {
                        return job;
                    }
                }
            }
        }
    }

    /**
     * Notes the stage and percent the recorder is at, and that it is alive.
     *
     * @throws BadRequestException the stage is not one of the active statuses
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}
     */
    public void progress(long clipId, ProgressRequest request) {
        if (!request.stage().isActive()) {
            throw new BadRequestException("stage must be " + ClipStatus.RECORDING + ", " + ClipStatus.ENCODING
                    + " or " + ClipStatus.UPLOADING);
        }
        persistence.progress(clipId, request.worker(), request.stage(), request.progress());
    }

    /**
     * Opens the demo of the clip's match for the recorder that holds the clip. The caller streams it and closes it.
     *
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}
     * @throws GoneException {@code DEMO_NOT_AVAILABLE}: the file is not stored (any more), or the demo is not parsed
     */
    public DemoDownload openDemo(long clipId, String worker) {
        String key = persistence.storedDemoKey(clipId, worker).orElseThrow(WorkerService::demoNotAvailable);
        try {
            long size = storage.size(key);
            return new DemoDownload(size, storage.get(key));
        } catch (StorageException e) {
            // A file the row names but the storage lacks is the demo being gone; any other failure is a real one.
            if (storage.exists(key)) {
                throw e;
            }
            throw demoNotAvailable();
        }
    }

    /**
     * Takes the video the recorder uploads and stores it as {@link #videoKey}; the clip becomes {@code UPLOADING}.
     *
     * @param declaredLength the {@code Content-Length} of the request, or -1 when it has none
     * @param body the raw bytes of the video, read once and not closed here
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}
     * @throws MaxUploadSizeExceededException the video is larger than {@code clip.upload-max-size}
     * @throws BadRequestException there is no video in the request, or it was cut off
     */
    public void storeVideo(long clipId, String worker, long declaredLength, InputStream body) {
        store(clipId, worker, "video", declaredLength, body, videoKey(clipId),
                size -> persistence.videoStored(clipId, worker, videoKey(clipId), size));
    }

    /** Takes the thumbnail in the same way and stores it as {@link #thumbnailKey}; the status of the clip stays. */
    public void storeThumbnail(long clipId, String worker, long declaredLength, InputStream body) {
        store(clipId, worker, "thumbnail", declaredLength, body, thumbnailKey(clipId),
                size -> persistence.thumbnailStored(clipId, worker, thumbnailKey(clipId)));
    }

    /**
     * Finishes the clip: {@code DONE}.
     *
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}, or {@code CLIP_VIDEO_MISSING}: no video was uploaded
     */
    public void complete(long clipId, CompleteRequest request) {
        persistence.complete(clipId, request.worker(), request.durationMs(), request.width(), request.height());
        log.info("Recorder {} finished clip {}: {} ms, {}x{}", request.worker(), clipId, request.durationMs(),
                request.width(), request.height());
    }

    /**
     * Ends the recorder's attempt: the clip goes back to the queue when the recorder says that another attempt may do
     * better and the clip has attempts left, and is failed otherwise. The recorder's text is kept, cut to
     * {@value #MAX_ERROR_LENGTH} characters.
     *
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}
     */
    public void fail(long clipId, FailRequest request) {
        String error = storableError(request.error());
        Ended ended = persistence.fail(clipId, request.worker(), error, request.retryable(), properties.maxAttempts());
        log.info("Recorder {} gave up an attempt at clip {} (attempt {} of {}): {}; {}", request.worker(), clipId,
                ended.attempts(), properties.maxAttempts(), ended.fate() == Fate.REQUEUED ? "queued again" : "failed",
                oneLine(error));
    }

    /** Notes that the recorder is there. */
    public void heartbeat(HeartbeatRequest request) {
        persistence.heartbeat(request.worker(), request.version(), request.mode(), request.state(), request.clipId());
    }

    /** No qualities named means every quality; a list is made a set, so that it cannot be made long by repeating. */
    private static Set<ClipQuality> qualitiesOf(List<ClipQuality> requested) {
        List<ClipQuality> named = requested == null ? List.of() : requested.stream().filter(Objects::nonNull).toList();
        return named.isEmpty() ? EnumSet.allOf(ClipQuality.class) : EnumSet.copyOf(named);
    }

    /**
     * The job for a clip the recorder has been given, with the size of the demo file. When the file is not there
     * although the demo row names it, the clip is failed instead and the recorder is given none.
     */
    private Optional<WorkerJob> jobOf(ClaimedClip clip, String worker) {
        OptionalLong demoSize = demoSize(clip.demoStorageKey());
        if (demoSize.isEmpty()) {
            try {
                persistence.fail(clip.clipId(), worker, WorkerPersistence.DEMO_GONE, false, properties.maxAttempts());
                log.info("Failed clip {} instead of giving it to {}: {} ({} is not in the storage)", clip.clipId(),
                        worker, WorkerPersistence.DEMO_GONE, clip.demoStorageKey());
            } catch (ConflictException e) {
                log.warn("Clip {} was taken from {} before it could be failed for its missing demo file", clip.clipId(),
                        worker);
            }
            return Optional.empty();
        }
        log.info("Gave clip {} to {}: attempt {} of {}", clip.clipId(), worker, clip.attempts(),
                properties.maxAttempts());
        return Optional.of(new WorkerJob(clip.clipId(), clip.kind(), clip.matchId(), clip.mapName(),
                clip.focusSteamId(), clip.tickRate(), clip.segments(), clip.width(), clip.height(), clip.fps(),
                demoSize.getAsLong(), clip.demoVersion()));
    }

    /**
     * The size of the stored object, or empty when it is not there. Any other failure of the storage (it cannot be
     * reached) is not a missing object, and is thrown.
     */
    private OptionalLong demoSize(String key) {
        try {
            return OptionalLong.of(storage.size(key));
        } catch (StorageException e) {
            if (storage.exists(key)) {
                throw e;
            }
            return OptionalLong.empty();
        }
    }

    private static GoneException demoNotAvailable() {
        return new GoneException(DEMO_NOT_AVAILABLE, "The demo file of this clip is not stored (any more)");
    }

    /**
     * One upload, in this order: the claim is looked at; the body goes to a temporary file, counted, and is refused if
     * it is larger than {@code clip.upload-max-size} (the declared length is held against it before a byte is read);
     * the file goes to the storage; and then the claim is looked at again, under the row lock, as the clip may have
     * been taken back while the upload ran, and the upload is recorded. If the claim was lost, the answer is a 409 and
     * the object stays in the storage, where the next attempt overwrites it and a delete removes it. No transaction is
     * open while the body is read or the storage is written, and the temporary file is deleted in every case.
     */
    private void store(long clipId, String worker, String what, long declaredLength, InputStream body, String key,
                       LongConsumer recordUpload) {
        persistence.requireHeldBy(clipId, worker);
        long max = properties.uploadMaxSize().toBytes();
        if (declaredLength > max) {
            throw new MaxUploadSizeExceededException(max);
        }
        Path file = null;
        try {
            file = receive(body, max);
            long size = sizeOf(file);
            if (size == 0) {
                throw new BadRequestException("The request body is empty");
            }
            storage.put(key, file);
            try {
                recordUpload.accept(size);
            } catch (ConflictException e) {
                log.warn("Recorder {} lost clip {} while it uploaded the {}; {} stays in the storage", worker, clipId,
                        what, key);
                throw e;
            }
            log.info("Stored the {} of clip {} from {}: {} bytes as {}", what, clipId, worker, size, key);
        } finally {
            deleteQuietly(file);
        }
    }

    /**
     * Copies the body to a new temporary file, counting what really arrives instead of believing a length header.
     *
     * @throws MaxUploadSizeExceededException the body is larger than {@code max} bytes
     * @throws BadRequestException the body cannot be read to its end (the recorder went away or broke the framing)
     * @throws UncheckedIOException the file cannot be written
     */
    private static Path receive(InputStream body, long max) {
        Path file;
        try {
            file = Files.createTempFile("clip-upload-", ".part");
        } catch (IOException e) {
            throw new UncheckedIOException("A temporary file for the upload could not be created", e);
        }
        boolean done = false;
        try (OutputStream out = Files.newOutputStream(file)) {
            byte[] buffer = new byte[COPY_BUFFER_SIZE];
            long total = 0;
            while (true) {
                int read = readOrBadRequest(body, buffer);
                if (read == -1) {
                    break;
                }
                total += read;
                if (total > max) {
                    throw new MaxUploadSizeExceededException(max);
                }
                out.write(buffer, 0, read);
            }
            done = true;
            return file;
        } catch (IOException e) {
            throw new UncheckedIOException("The upload could not be written to a temporary file", e);
        } finally {
            if (!done) {
                deleteQuietly(file);
            }
        }
    }

    /** A read that fails is the sender's doing (it hung up half way); the writing of the file, the server's. */
    private static int readOrBadRequest(InputStream body, byte[] buffer) {
        try {
            return body.read(buffer);
        } catch (IOException e) {
            log.warn("An upload ended before its end: {}", e.toString());
            throw new BadRequestException("The request body could not be read to its end");
        }
    }

    private static long sizeOf(Path file) {
        try {
            return Files.size(file);
        } catch (IOException e) {
            throw new UncheckedIOException("The size of the uploaded file could not be read", e);
        }
    }

    private static void deleteQuietly(Path file) {
        if (file == null) {
            return;
        }
        try {
            Files.deleteIfExists(file);
        } catch (IOException ignored) {
            // Nothing more can be done about a file that cannot be deleted; the OS cleans the temp directory.
        }
    }

    /**
     * The text of an error the way it is stored: some text always, with no character PostgreSQL's {@code text} cannot
     * hold, and not longer than {@link #MAX_ERROR_LENGTH}, with a mark where it was cut.
     */
    static String storableError(String error) {
        if (error == null || error.isBlank()) {
            return NO_REASON;
        }
        String text = error.strip().replace('\u0000', '?');
        if (text.length() <= MAX_ERROR_LENGTH) {
            return text;
        }
        int end = MAX_ERROR_LENGTH - CUT_MARK.length();
        if (Character.isHighSurrogate(text.charAt(end - 1))) {
            end--;
        }
        return text.substring(0, end) + CUT_MARK;
    }

    private static String oneLine(String text) {
        String line = text.replaceAll("\\s+", " ");
        return line.length() <= LOGGED_ERROR_LENGTH ? line : line.substring(0, LOGGED_ERROR_LENGTH) + CUT_MARK;
    }
}
