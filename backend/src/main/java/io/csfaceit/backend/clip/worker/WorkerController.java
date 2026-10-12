package io.csfaceit.backend.clip.worker;

import io.csfaceit.backend.clip.worker.WorkerService.DemoDownload;
import io.csfaceit.backend.clip.worker.dto.ClaimRequest;
import io.csfaceit.backend.clip.worker.dto.CompleteRequest;
import io.csfaceit.backend.clip.worker.dto.FailRequest;
import io.csfaceit.backend.clip.worker.dto.HeartbeatRequest;
import io.csfaceit.backend.clip.worker.dto.ProgressRequest;
import io.csfaceit.backend.clip.worker.dto.WorkerJob;
import io.csfaceit.backend.clip.worker.dto.WorkerLimits;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.io.InputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
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
 * The API of the recorder, the only one it knows: it takes a queued clip, reports on it, downloads the demo, uploads the
 * video and the thumbnail, and finishes or gives up the clip. Everything under it needs the worker token
 * ({@code X-Worker-Token}, see {@code SecurityConfig}), reads included, and nothing else in the application takes that
 * token. The recorder names itself in each request ({@code worker}, in the body or in the query), and a clip that it
 * does not hold is a {@code 409 CLIP_NOT_CLAIMED} in every request about a clip.
 *
 * <p>The video and the thumbnail are the raw bytes of the file in the body of a {@code PUT}, with the content type of
 * the file ({@code video/mp4}, {@code image/jpeg}); another content type is a 415. The demo goes the other way, as
 * {@code application/zstd}, with its length.
 */
@RestController
@RequestMapping("/api/worker/v1")
@Validated
public class WorkerController {

    static final String ZSTD = "application/zstd";
    static final String VIDEO_MP4 = "video/mp4";
    static final String IMAGE_JPEG = "image/jpeg";

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
     * Sends the demo file as it is stored (zstd), streamed from the storage and never held in memory. Once the status
     * and the length have gone out nothing can be changed, so a transfer that breaks (the recorder hangs up, the
     * storage fails) can only be noted and ends with the connection closed short of the length.
     */
    @GetMapping("/clips/{clipId}/demo")
    public void downloadDemo(@PathVariable long clipId,
                             @RequestParam @NotBlank @Size(max = WorkerLimits.NAME) String worker,
                             HttpServletResponse response) {
        DemoDownload demo = service.openDemo(clipId, worker);
        try (InputStream content = demo.content()) {
            response.setContentType(ZSTD);
            response.setContentLengthLong(demo.sizeBytes());
            content.transferTo(response.getOutputStream());
        } catch (IOException e) {
            log.warn("The demo download of clip {} to {} ended before its end: {}", clipId, worker, e.toString());
        }
    }

    /** Takes the video: the raw bytes of an MP4 file. 204 once it is stored. */
    @PutMapping(path = "/clips/{clipId}/video", consumes = VIDEO_MP4)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void uploadVideo(@PathVariable long clipId,
                            @RequestParam @NotBlank @Size(max = WorkerLimits.NAME) String worker,
                            HttpServletRequest request) throws IOException {
        service.storeVideo(clipId, worker, request.getContentLengthLong(), request.getInputStream());
    }

    /** Takes the thumbnail: the raw bytes of a JPEG file. 204 once it is stored. */
    @PutMapping(path = "/clips/{clipId}/thumbnail", consumes = IMAGE_JPEG)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void uploadThumbnail(@PathVariable long clipId,
                                @RequestParam @NotBlank @Size(max = WorkerLimits.NAME) String worker,
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
}
