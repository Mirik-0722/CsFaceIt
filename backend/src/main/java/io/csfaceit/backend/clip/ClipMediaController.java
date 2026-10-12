package io.csfaceit.backend.clip;

import io.csfaceit.backend.analysis.highlight.HighlightType;
import io.csfaceit.backend.clip.ClipQueryService.ClipMedia;
import io.csfaceit.backend.common.api.ApiError;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.common.api.RangeNotSatisfiableException;
import io.csfaceit.backend.storage.StorageException;
import io.csfaceit.backend.storage.StorageService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Gives the video and the thumbnail of a finished clip to browsers. Both are open reads like the rest of
 * {@code /api/v1}, and {@code HEAD} answers as {@code GET} does, without the body. Only a {@code DONE} clip has either;
 * for any other clip, one that does not exist and a {@code DONE} one whose file is gone from the storage, the answer is
 * {@code 404 CLIP_NOT_FOUND}. The files are the ones the row names ({@code video_key}, {@code thumbnail_key}), never a
 * name worked out from the id: every attempt to record a clip uploads under keys of its own, and the row says which
 * attempt's files are the clip's.
 *
 * <p>The video honours a single {@code Range}, in the forms {@code bytes=a-b} and {@code bytes=a-} (an end beyond the
 * last byte is cut to it): Safari and iOS play nothing without it, and every browser seeks with it. The answer is
 * {@code 206} with a {@code Content-Range}, or {@code 416} when the range starts at or beyond the end. A {@code Range}
 * of any other kind (several ranges, the last {@code n} bytes, another unit, text that is no range) is ignored, which
 * HTTP allows, and the whole file is sent with {@code 200}. The length of the file is what the storage says for the
 * key, never the size the row records.
 *
 * <p>The bytes go from the storage to the client in pieces of a fixed size and are never held in memory, with no
 * database transaction open (the clip is read before the first byte goes out), and the storage stream is closed in
 * every case. A client that goes away part way, as a browser does when it seeks, is normal and only a debug line.
 *
 * <p>The files of a finished clip never change, so every answer that carries one (the {@code 200} and the {@code 206}
 * of the video, with or without {@code download}, the thumbnail, and {@code HEAD} for either) says
 * {@code Cache-Control: public, max-age=86400}; an error answer keeps the {@code no-store} that Spring Security gives
 * every answer that sets no caching of its own. A storage that cannot be asked for a file is a
 * {@code 503 STORAGE_UNAVAILABLE}, see {@link #handleStorageFailure}.
 */
@RestController
@RequestMapping("/api/v1/clips")
public class ClipMediaController {

    private static final String CLIP_NOT_FOUND = "CLIP_NOT_FOUND";
    private static final String STORAGE_UNAVAILABLE = "STORAGE_UNAVAILABLE";

    private static final String VIDEO_MP4 = "video/mp4";
    private static final String IMAGE_JPEG = "image/jpeg";
    private static final String ACCEPT_RANGES_BYTES = "bytes";

    /** The video and the thumbnail of a done clip never change, so a browser may keep either for a day. */
    private static final String MEDIA_CACHE_CONTROL = "public, max-age=86400";

    private static final int COPY_BUFFER_SIZE = 64 * 1024;

    /** What the name of a downloaded file may not contain, character by character. */
    private static final Pattern UNSAFE_FILE_NAME_CHARACTER = Pattern.compile("[^A-Za-z0-9._-]");

    private static final Logger log = LoggerFactory.getLogger(ClipMediaController.class);

    private final ClipQueryService queries;
    private final StorageService storage;

    public ClipMediaController(ClipQueryService queries, StorageService storage) {
        this.queries = queries;
        this.storage = storage;
    }

    /**
     * The video: the whole file with 200, or the part a {@code Range} asks for with 206. With {@code download} the
     * answer carries a {@code Content-Disposition} that names the file, so that a browser saves it instead of playing
     * it; the ranges work the same.
     */
    @GetMapping("/{clipId}/video")
    public void video(@PathVariable long clipId,
                      @RequestParam(defaultValue = "false") boolean download,
                      @RequestHeader(name = HttpHeaders.RANGE, required = false) String range,
                      HttpServletRequest request, HttpServletResponse response) {
        ClipMedia clip = doneClip(clipId, "video");
        String key = clip.videoKey();
        if (key == null) {
            // A clip becomes DONE only with a video, so a row that says otherwise is damaged.
            log.warn("Clip {} is DONE but its row names no video", clipId);
            throw fileNotAvailable(clipId);
        }
        long size = sizeOf(clipId, key);

        Optional<ByteRange> asked = ByteRange.parse(range);
        long start = 0;
        long length = size;
        if (asked.isPresent()) {
            long first = asked.get().first();
            if (first >= size) {
                throw new RangeNotSatisfiableException(size,
                        "The video is " + size + " bytes long, it has no byte " + first);
            }
            start = first;
            length = Math.min(asked.get().last(), size - 1) - start + 1;
        }

        try (InputStream body = hasBody(request, length) ? open(clipId, key, start, length) : null) {
            response.setStatus(asked.isPresent() ? HttpStatus.PARTIAL_CONTENT.value() : HttpStatus.OK.value());
            response.setContentType(VIDEO_MP4);
            response.setHeader(HttpHeaders.ACCEPT_RANGES, ACCEPT_RANGES_BYTES);
            response.setHeader(HttpHeaders.CACHE_CONTROL, MEDIA_CACHE_CONTROL);
            response.setContentLengthLong(length);
            if (asked.isPresent()) {
                response.setHeader(HttpHeaders.CONTENT_RANGE,
                        "bytes " + start + "-" + (start + length - 1) + "/" + size);
            }
            if (download) {
                response.setHeader(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(downloadName(clip)).build().toString());
            }
            if (body != null) {
                transfer(clipId, "video", body, length, response);
            }
        } catch (IOException e) {
            log.debug("The storage stream of the video of clip {} could not be closed: {}", clipId, e.toString());
        }
    }

    /** The thumbnail, a JPEG, always whole; 404 when the recorder uploaded none. */
    @GetMapping("/{clipId}/thumbnail")
    public void thumbnail(@PathVariable long clipId, HttpServletRequest request, HttpServletResponse response) {
        String key = doneClip(clipId, "thumbnail").thumbnailKey();
        if (key == null) {
            throw new NotFoundException(CLIP_NOT_FOUND, "Clip " + clipId + " has no thumbnail");
        }
        long size = sizeOf(clipId, key);

        try (InputStream body = hasBody(request, size) ? open(clipId, key, 0, size) : null) {
            response.setContentType(IMAGE_JPEG);
            response.setHeader(HttpHeaders.CACHE_CONTROL, MEDIA_CACHE_CONTROL);
            response.setContentLengthLong(size);
            if (body != null) {
                transfer(clipId, "thumbnail", body, size, response);
            }
        } catch (IOException e) {
            log.debug("The storage stream of the thumbnail of clip {} could not be closed: {}", clipId, e.toString());
        }
    }

    /**
     * The storage could not be asked for a file, or failed for a reason other than the file being gone (a file that is
     * simply missing is a 404, which {@link #missingOrFailed} decides before this is reached): 503
     * {@code STORAGE_UNAVAILABLE} in the shared error shape, with a fixed text, so that a player or a page can tell an
     * outage from a clip that is gone. The log gets one line without a stack trace, since an outage would otherwise be
     * a 500 and an error with a stack trace for every request of an open endpoint. This handler is the controller's
     * own, so the rest of the application keeps its answer for a storage failure.
     *
     * <p>When the response has already started, no status can be given any more: the exception is then thrown on, as
     * the recorder's API does, and the container breaks the connection. The storage is asked for the size and for the
     * stream before the first header is set, and a stream that breaks after it is only noted (see {@link #transfer}),
     * so with the code as it is no response that has started gets here; this is for one that would.
     */
    @ExceptionHandler(StorageException.class)
    ResponseEntity<ApiError> handleStorageFailure(StorageException ex, HttpServletResponse response) {
        if (response.isCommitted()) {
            throw ex;
        }
        Throwable cause = ex.getCause() == null ? ex : ex.getCause();
        log.warn("The storage failed a request for a file of a clip, answering 503: {} ({})", ex.getMessage(),
                cause.toString());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(new ApiError(STORAGE_UNAVAILABLE, "The storage is not available, try again later"));
    }

    /** The clip, provided it is {@code DONE}: the only status in which it has files. */
    private ClipMedia doneClip(long clipId, String what) {
        ClipMedia clip = queries.media(clipId);
        if (clip.status() != ClipStatus.DONE) {
            throw new NotFoundException(CLIP_NOT_FOUND,
                    "Clip " + clipId + " has no " + what + " (it is " + clip.status() + ")");
        }
        return clip;
    }

    /** The length of the stored file; a file the storage does not have is a 404, one it cannot look up is an error. */
    private long sizeOf(long clipId, String key) {
        try {
            return storage.size(key);
        } catch (StorageException e) {
            throw missingOrFailed(clipId, key, e);
        }
    }

    /**
     * Opens {@code length} bytes of the file from {@code start}. The headers are set only after this has succeeded, so
     * that a file that has gone since its size was asked (the clip was deleted meanwhile) is still a clean 404.
     */
    private InputStream open(long clipId, String key, long start, long length) {
        try {
            return storage.get(key, start, length);
        } catch (StorageException e) {
            throw missingOrFailed(clipId, key, e);
        }
    }

    /**
     * A {@code DONE} clip whose file is not in the storage is a 404 and a warning, since it should be there; a storage
     * that fails for another reason is not the file being missing, and its exception is the one to throw.
     */
    private RuntimeException missingOrFailed(long clipId, String key, StorageException failure) {
        if (storage.exists(key)) {
            return failure;
        }
        log.warn("Clip {} is DONE but {} is not in the storage", clipId, key);
        return fileNotAvailable(clipId);
    }

    private static NotFoundException fileNotAvailable(long clipId) {
        return new NotFoundException(CLIP_NOT_FOUND, "The file of clip " + clipId + " is not available");
    }

    /** A {@code HEAD} request, and a file with nothing in it, get the headers only. */
    private static boolean hasBody(HttpServletRequest request, long length) {
        return length > 0 && !HttpMethod.HEAD.matches(request.getMethod());
    }

    /**
     * Copies {@code length} bytes to the response. The status and the length have gone out by the first write, so a
     * transfer that breaks can only be noted and ends with the connection closed short of the length. It tells the two
     * ways it can break apart: the storage failing is a warning, the client going away is normal.
     */
    private static void transfer(long clipId, String what, InputStream body, long length,
                                 HttpServletResponse response) {
        byte[] buffer = new byte[COPY_BUFFER_SIZE];
        OutputStream out;
        try {
            out = response.getOutputStream();
        } catch (IOException e) {
            log.debug("The response of the {} of clip {} is gone: {}", what, clipId, e.toString());
            return;
        }
        long sent = 0;
        while (sent < length) {
            int read;
            try {
                read = body.read(buffer, 0, (int) Math.min(buffer.length, length - sent));
            } catch (IOException e) {
                log.warn("The storage failed while the {} of clip {} was sent, after {} of {} bytes: {}", what, clipId,
                        sent, length, e.toString());
                return;
            }
            if (read < 0) {
                log.warn("The {} of clip {} ended after {} of {} bytes", what, clipId, sent, length);
                return;
            }
            try {
                out.write(buffer, 0, read);
            } catch (IOException e) {
                // A browser that seeks cancels the request it no longer needs; the connection is gone, not the file.
                log.debug("The client of the {} of clip {} went away after {} of {} bytes", what, clipId, sent, length);
                return;
            }
            sent += read;
        }
    }

    /**
     * The name a downloaded video is saved under: {@code <nickname>-<type>-r<round>.mp4}, for a compilation
     * {@code <nickname>-compilation.mp4}. A character of the nickname that is not a letter, a digit, a dot, an
     * underscore or a hyphen is replaced with an underscore, so the name is safe in a header and on every file system.
     */
    private static String downloadName(ClipMedia clip) {
        String nickname = UNSAFE_FILE_NAME_CHARACTER.matcher(clip.nickname()).replaceAll("_");
        String what = clip.kind() == ClipKind.COMPILATION
                ? "compilation" : typeLabel(clip.highlightType()) + "-r" + clip.roundNumber();
        return nickname + "-" + what + ".mp4";
    }

    /**
     * The type in lower case with a hyphen for each underscore ({@code k4}, {@code clutch-1v3}, {@code smoke-kill}). A
     * ninja defuse is a {@code defuse}, as in the interface, whose rule cannot tell a real ninja defuse apart.
     */
    private static String typeLabel(HighlightType type) {
        if (type == HighlightType.NINJA_DEFUSE) {
            return "defuse";
        }
        return type.name().toLowerCase(Locale.ROOT).replace('_', '-');
    }

    /**
     * The one range of a {@code Range} header that is honoured: {@code bytes=first-} or {@code bytes=first-last}. A
     * missing {@code last} is {@link Long#MAX_VALUE}, which is the same thing as an end beyond the file, since both are
     * cut to its last byte. A number too large for a {@code long} is {@link Long#MAX_VALUE} as well.
     */
    private record ByteRange(long first, long last) {

        private static final Pattern SINGLE = Pattern.compile("bytes=(\\d+)-(\\d*)", Pattern.CASE_INSENSITIVE);

        /**
         * The range the header asks for, or empty when there is none or it is not one to honour (it is then ignored).
         */
        static Optional<ByteRange> parse(String header) {
            if (header == null) {
                return Optional.empty();
            }
            Matcher single = SINGLE.matcher(header.strip());
            if (!single.matches()) {
                return Optional.empty();
            }
            long first = position(single.group(1));
            long last = single.group(2).isEmpty() ? Long.MAX_VALUE : position(single.group(2));
            // A range that ends before it starts is no range at all.
            return last < first ? Optional.empty() : Optional.of(new ByteRange(first, last));
        }

        /** The digits as a number; more than a {@code long} holds is as good as the largest one. */
        private static long position(String digits) {
            try {
                return Long.parseLong(digits);
            } catch (NumberFormatException e) {
                return Long.MAX_VALUE;
            }
        }
    }
}
