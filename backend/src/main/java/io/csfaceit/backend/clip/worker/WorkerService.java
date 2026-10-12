package io.csfaceit.backend.clip.worker;

import io.csfaceit.backend.clip.ClipFiles;
import io.csfaceit.backend.clip.ClipMetrics;
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
import java.time.Duration;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.Set;
import java.util.function.IntFunction;
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

    /** What an upload does to the clip once its file is in storage: the row of {@code attempt} learns the key. */
    @FunctionalInterface
    private interface UploadRecorder {

        void record(int attempt, String key, long sizeBytes);
    }

    private final WorkerPersistence persistence;
    private final StorageService storage;
    private final ClipProperties properties;
    private final ClipMetrics metrics;

    public WorkerService(WorkerPersistence persistence, StorageService storage, ClipProperties properties,
                         ClipMetrics metrics) {
        this.persistence = persistence;
        this.storage = storage;
        this.properties = properties;
        this.metrics = metrics;
    }

    /**
     * Gives the recorder the oldest queued clip of the qualities it can record, which becomes {@code RECORDING}, or
     * nothing when none is waiting. Each turn takes one clip in its own short transaction; one that cannot be recorded
     * (its demo file is gone, its player has no Steam ID) is failed there and the next is taken, so the loop ends: a
     * failed clip is not queued any more. The size of the demo file is asked of the storage after the claim has
     * committed. A clip whose file is not there although the row names it is failed too, and the next is taken. If the
     * storage cannot be asked at all, the clip goes back to the queue with its attempt and the failure is thrown (the
     * recorder is answered with a 503, and the next clip is not touched, so an outage cannot strand the queue).
     *
     * @throws StorageException the storage could not be asked
     */
    public Optional<WorkerJob> claim(ClaimRequest request) {
        String worker = request.worker();
        Set<ClipQuality> qualities = qualitiesOf(request.qualities());
        while (true) {
            switch (persistence.claimNext(worker, request.version(), request.mode(), qualities)) {
                case Turn.NothingWaiting nothing -> {
                    return Optional.empty();
                }
                case Turn.Rejected rejected -> {
                    metrics.failed();
                    log.info("Failed clip {} instead of giving it to {}: {}", rejected.clipId(), worker,
                            rejected.reason());
                }
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
     * Takes the video the recorder uploads and stores it under {@link ClipFiles#video} of the attempt the recorder
     * holds the clip in; the clip becomes {@code UPLOADING}. See {@link #store} for what happens to an upload of a
     * recorder that loses the clip on the way.
     *
     * @param declaredLength the {@code Content-Length} of the request, or -1 when it has none
     * @param body the raw bytes of the video, read once and not closed here
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}
     * @throws MaxUploadSizeExceededException the video is larger than {@code clip.upload-max-size}
     * @throws BadRequestException there is no video in the request, or it was cut off
     */
    public void storeVideo(long clipId, String worker, long declaredLength, InputStream body) {
        store(clipId, worker, "video", declaredLength, body, attempt -> ClipFiles.video(clipId, attempt),
                (attempt, key, size) -> persistence.videoStored(clipId, worker, attempt, key, size));
    }

    /** Takes the thumbnail in the same way, under {@link ClipFiles#thumbnail}; the status of the clip stays. */
    public void storeThumbnail(long clipId, String worker, long declaredLength, InputStream body) {
        store(clipId, worker, "thumbnail", declaredLength, body, attempt -> ClipFiles.thumbnail(clipId, attempt),
                (attempt, key, size) -> persistence.thumbnailStored(clipId, worker, attempt, key));
    }

    /**
     * Finishes the clip: {@code DONE}.
     *
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}, or {@code CLIP_VIDEO_MISSING}: no video was uploaded
     */
    public void complete(long clipId, CompleteRequest request) {
        Optional<Duration> held = persistence.complete(clipId, request.worker(), request.durationMs(), request.width(),
                request.height());
        metrics.done();
        held.ifPresent(metrics::recorded);
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
        if (ended.fate() == Fate.REQUEUED) {
            metrics.requeued();
        } else {
            metrics.failed();
        }
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
     * although the demo row names it, the clip is failed instead and the recorder is given none. When the storage
     * cannot be asked at all, the recorder gets no job either: the clip goes back to the queue together with the
     * attempt the claim counted (see {@link #giveBack}), and the failure goes on to the caller as it is.
     *
     * @throws StorageException the storage could not be asked
     */
    private Optional<WorkerJob> jobOf(ClaimedClip clip, String worker) {
        OptionalLong demoSize;
        try {
            demoSize = demoSize(clip.demoStorageKey());
        } catch (StorageException e) {
            giveBack(clip, worker);
            throw e;
        }
        if (demoSize.isEmpty()) {
            try {
                persistence.fail(clip.clipId(), worker, WorkerPersistence.DEMO_GONE, false, properties.maxAttempts());
                metrics.failed();
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
     * Gives the clip that was just claimed back to the queue, with its attempt: the recorder is about to get an error
     * and not the clip, and a clip that nobody works on must neither wait for the stale check nor use an attempt up
     * (a storage that is down would otherwise strand a queued clip with every poll of the recorder). If the clip cannot
     * be given back, which only a failure of the database or a clip taken away in the meantime can cause, it is left
     * to the stale check, and the storage failure stays the answer.
     */
    private void giveBack(ClaimedClip clip, String worker) {
        try {
            persistence.giveBack(clip.clipId(), worker, clip.attempts());
            metrics.requeued();
            log.warn("The storage could not be asked for the demo of clip {}: it is back in the queue, not given to {}",
                    clip.clipId(), worker);
        } catch (ConflictException e) {
            log.warn("Clip {} was taken from {} before it could be given back after a storage failure", clip.clipId(),
                    worker);
        } catch (RuntimeException e) {
            log.error("Clip {} could not be given back after a storage failure; the stale check will return it",
                    clip.clipId(), e);
        }
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
     * One upload, in this order: the claim is looked at, which tells the attempt the recorder holds the clip in; the
     * body goes to a temporary file, counted, and is refused if it is larger than {@code clip.upload-max-size} (the
     * declared length is held against it before a byte is read); the claim is looked at once more, so that a body that
     * arrives after the clip was taken away is normally not stored at all; the file goes to the storage under the keys
     * of that attempt; and then the claim is looked at again under the row lock, which has to find the clip held by the
     * same recorder in the same attempt, and the upload is recorded.
     *
     * <p>The row of the clip is never changed by an upload of a recorder that is not the holder any more, nor of an
     * attempt that is over: the answer is a 409. Between the last two looks lies the transfer to the storage, and a
     * clip can be taken away in it. The object of such an upload is stored all the same, but under the key of its own
     * attempt, which no other attempt writes and no row names: nothing reads it, and deleting the clip removes the
     * files of every attempt. So a late upload cannot replace the object that the row names, as one key for all
     * attempts would let it. No transaction is open while the body is read or the storage is written, and the
     * temporary file is deleted in every case.
     */
    private void store(long clipId, String worker, String what, long declaredLength, InputStream body,
                       IntFunction<String> keyOfAttempt, UploadRecorder recorder) {
        int attempt = persistence.attemptHeldBy(clipId, worker);
        String key = keyOfAttempt.apply(attempt);
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
            try {
                persistence.requireHeldIn(clipId, worker, attempt);
            } catch (ConflictException e) {
                log.warn("Recorder {} lost clip {} (attempt {}) while it uploaded the {}; the body is not stored",
                        worker, clipId, attempt, what);
                throw e;
            }
            storage.put(key, file);
            try {
                recorder.record(attempt, key, size);
            } catch (ConflictException e) {
                log.warn("Recorder {} lost clip {} (attempt {}) while it uploaded the {}; {} stays in the storage and "
                        + "no row names it", worker, clipId, attempt, what, key);
                throw e;
            }
            log.info("Stored the {} of clip {} (attempt {}) from {}: {} bytes as {}", what, clipId, attempt, worker,
                    size, key);
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
