package io.csfaceit.backend.clip.worker;

import io.csfaceit.backend.clip.worker.WorkerService.DemoDownload;
import io.csfaceit.backend.clip.worker.dto.ClaimRequest;
import io.csfaceit.backend.clip.worker.dto.CompleteRequest;
import io.csfaceit.backend.clip.worker.dto.FailRequest;
import io.csfaceit.backend.clip.worker.dto.HeartbeatRequest;
import io.csfaceit.backend.clip.worker.dto.ProgressRequest;
import io.csfaceit.backend.clip.worker.dto.WorkerJob;
import io.csfaceit.backend.clip.worker.dto.WorkerName;
import io.csfaceit.backend.common.api.ApiError;
import io.csfaceit.backend.storage.StorageException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The API of the recorder, the only one it knows: it takes a queued clip, reports on it, downloads the demo, uploads
 * the video and the thumbnail, and finishes or gives up the clip. Everything under it needs the worker token
 * ({@code X-Worker-Token}, see {@code SecurityConfig}), reads included, and nothing else in the application takes that
 * token. The recorder names itself in each request ({@code worker}, in the body or in the query), and a clip that it
 * does not hold is a {@code 409 CLIP_NOT_CLAIMED} in every request about a clip.
 *
 * <p>The video and the thumbnail are the raw bytes of the file in the body of a {@code PUT}, with the content type of
 * the file ({@code video/mp4}, {@code image/jpeg}); another content type is a 415. The demo goes the other way, as
 * {@code application/zstd}, with its length.
 *
 * <p>A storage that cannot do what a request needs is a {@code 503 STORAGE_UNAVAILABLE}, which tells the recorder to
 * wait and ask again; see {@link #handleStorageFailure}.
 */
@RestController
@RequestMapping("/api/worker/v1")
@Validated
public class WorkerController {

    static final String ZSTD = "application/zstd";
    static final String VIDEO_MP4 = "video/mp4";
    static final String IMAGE_JPEG = "image/jpeg";

    static final String STORAGE_UNAVAILABLE = "STORAGE_UNAVAILABLE";

    private static final int COPY_BUFFER_SIZE = 64 * 1024;

    private static final Logger log = LoggerFactory.getLogger(WorkerController.class);

    private final WorkerService service;

    public WorkerController(WorkerService service) {
        this.service = service;
    }

    /** 200 and the clip the recorder is to record, or 204 when none is waiting. */
    @PostMapping("/claim")
    public ResponseEntity<WorkerJob> claim(@Valid @RequestBody ClaimRequest request) {
        return service.claim(request).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PostMapping("/clips/{clipId}/progress")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void progress(@PathVariable long clipId, @Valid @RequestBody ProgressRequest request) {
        service.progress(clipId, request);
    }

    /**
     * Sends the demo file as it is stored (zstd), streamed from the storage and never held in memory. The first piece
     * is read before the status and the length go out, so a storage that fails at once is still an error response. A
     * read that fails later, with the file half sent, can no longer be told in a status: it is thrown, and the
     * connection is broken (see {@link #handleStorageFailure}), because a recorder that is handed a normal end of a
     * body shorter than the length it was promised would wait for the rest. A write that fails is the recorder having
     * gone away: its doing, noted in the log in one line, and the end of the matter.
     */
    @GetMapping("/clips/{clipId}/demo")
    public void downloadDemo(@PathVariable long clipId, @RequestParam @WorkerName String worker,
                             HttpServletResponse response) throws IOException {
        DemoDownload demo = service.openDemo(clipId, worker);
        InputStream content = demo.content();
        try {
            byte[] buffer = new byte[COPY_BUFFER_SIZE];
            int read = readFromStorage(content, buffer);
            if (read == -1 && demo.sizeBytes() > 0) {
                throw new StorageException("The demo of clip " + clipId + " is empty in the storage");
            }
            response.setContentType(ZSTD);
            response.setContentLengthLong(demo.sizeBytes());
            OutputStream out = response.getOutputStream();
            long sent = 0;
            while (read != -1) {
                try {
                    out.write(buffer, 0, read);
                } catch (IOException e) {
                    log.warn("The demo download of clip {} to {} ended after {} bytes, the recorder went away: {}",
                            clipId, worker, sent, e.toString());
                    return;
                }
                sent += read;
                read = readFromStorage(content, buffer);
            }
            if (sent < demo.sizeBytes()) {
                throw new StorageException("The demo of clip " + clipId + " ended after " + sent + " of "
                        + demo.sizeBytes() + " bytes in the storage");
            }
        } finally {
            closeQuietly(content);
        }
    }

    /** Takes the video: the raw bytes of an MP4 file. 204 once it is stored. */
    @PutMapping(path = "/clips/{clipId}/video", consumes = VIDEO_MP4)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void uploadVideo(@PathVariable long clipId, @RequestParam @WorkerName String worker,
                            HttpServletRequest request) throws IOException {
        service.storeVideo(clipId, worker, request.getContentLengthLong(), request.getInputStream());
    }

    /** Takes the thumbnail: the raw bytes of a JPEG file. 204 once it is stored. */
    @PutMapping(path = "/clips/{clipId}/thumbnail", consumes = IMAGE_JPEG)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void uploadThumbnail(@PathVariable long clipId, @RequestParam @WorkerName String worker,
                                HttpServletRequest request) throws IOException {
        service.storeThumbnail(clipId, worker, request.getContentLengthLong(), request.getInputStream());
    }

    @PostMapping("/clips/{clipId}/complete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void complete(@PathVariable long clipId, @Valid @RequestBody CompleteRequest request) {
        service.complete(clipId, request);
    }

    @PostMapping("/clips/{clipId}/fail")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void fail(@PathVariable long clipId, @Valid @RequestBody FailRequest request) {
        service.fail(clipId, request);
    }

    @PostMapping("/heartbeat")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void heartbeat(@Valid @RequestBody HeartbeatRequest request) {
        service.heartbeat(request);
    }

    /**
     * The storage could not do what a request of a recorder needed (it cannot be reached, or a read broke): 503
     * {@code STORAGE_UNAVAILABLE} in the shared error shape, so that the recorder backs off and asks again later. This
     * handler is the controller's own, so it covers the recorder's API only and the rest of the application keeps its
     * answer for a storage failure.
     *
     * <p>When the response has already started, as in a demo of which a part has been sent, no status can be given any
     * more. The exception is then thrown on, past the handlers of the application, and the container breaks the
     * connection, which is how the recorder learns that the file is incomplete.
     */
    @ExceptionHandler(StorageException.class)
    ResponseEntity<ApiError> handleStorageFailure(StorageException ex, HttpServletResponse response) {
        if (response.isCommitted()) {
            throw ex;
        }
        // Not what a demo download had prepared (its length and type); the answer is the error alone.
        response.reset();
        Throwable cause = ex.getCause() == null ? ex : ex.getCause();
        log.warn("The storage failed a request of a recorder, answering 503: {} ({})", ex.getMessage(),
                cause.toString());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(new ApiError(STORAGE_UNAVAILABLE, "The storage is not available, try again later"));
    }

    /** A piece of the demo from the storage; a read that fails is the storage's failure, not the recorder's. */
    private static int readFromStorage(InputStream content, byte[] buffer) {
        try {
            return content.read(buffer);
        } catch (IOException e) {
            throw new StorageException("The demo could not be read from the storage", e);
        }
    }

    private static void closeQuietly(InputStream content) {
        try {
            content.close();
        } catch (IOException e) {
            log.debug("The stream of the demo could not be closed: {}", e.toString());
        }
    }
}
