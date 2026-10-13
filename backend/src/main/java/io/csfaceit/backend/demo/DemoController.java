package io.csfaceit.backend.demo;

import static io.csfaceit.backend.match.MatchController.MATCH_ID_MESSAGE;
import static io.csfaceit.backend.match.MatchController.MATCH_ID_PATTERN;

import io.csfaceit.backend.auth.Access;
import io.csfaceit.backend.auth.Actor;
import io.csfaceit.backend.common.api.BadRequestException;
import io.csfaceit.backend.demo.dto.DemoResponse;
import io.csfaceit.backend.usage.UsageKind;
import io.csfaceit.backend.usage.UsageService;
import io.csfaceit.backend.usage.UsageService.Reservation;
import jakarta.validation.constraints.Pattern;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

/**
 * Bringing the demo of a match (import, upload), asking for its analysis, and reading where it is. The three
 * {@code POST}s take the admin key ({@code X-API-Key}) or a session: an administrator does what the key does, and any
 * other signed-in user acts for the matches they played, which {@link DemoService} asks {@link Access} about. The
 * controller only says who is acting.
 */
@RestController
@RequestMapping("/api/v1/matches")
@Validated
public class DemoController {

    /** The name of the multipart part that carries the demo. */
    static final String FILE_PART = "file";

    /** What the name of an uploaded demo ends with: raw, gzip or zstd. The content is checked by its bytes, not its name. */
    private static final List<String> DEMO_FILE_SUFFIXES = List.of(".dem", ".dem.gz", ".dem.zst");

    private final DemoService service;
    private final Access access;
    private final UsageService usage;

    public DemoController(DemoService service, Access access, UsageService usage) {
        this.service = service;
        this.access = access;
        this.usage = usage;
    }

    /**
     * Needs the admin key or a session; a user has to be in the roster of the match (403 otherwise) and has so many
     * imports per day (429 {@code IMPORT_LIMIT_REACHED}, only for a request that would queue something).
     */
    @PostMapping("/{matchId}/demo/import")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DemoResponse requestImport(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return service.requestImport(access.current(), matchId);
    }

    /**
     * Takes the demo of the match as a file instead of downloading it from FACEIT. Needs the admin key or a session; a
     * user has to be in the roster of the match (403 otherwise) and cannot replace a demo that has been parsed (409
     * {@code DEMO_ALREADY_PARSED}). The answer is 202 with the demo as it is once stored: STORED, and announced for
     * parsing.
     *
     * <p><b>Who may upload is decided before the file is received.</b> The body of a multipart request is read lazily
     * ({@code spring.servlet.multipart.resolve-lazily}), so nothing of it is on the server's disk when this method
     * starts, and the method takes the request, not the part: a parameter that is the part (or anything else that
     * reads a parameter or a part of the request) would have the whole file received first, up to the upload limit,
     * for a caller who is then refused. {@link DemoService#requireUploadAllowed} comes first, and only then is the
     * part asked for, which is the moment the body is read. A request without the part is the 400 it always was.
     *
     * <p><b>So is whether the user has an upload left today</b> (429 {@code UPLOAD_LIMIT_REACHED}): the place is taken
     * right after that check and before the body is read, so a user at the limit sends the server nothing to keep
     * either, and the rules above have refused first whoever they refuse. The place is given back when the upload then
     * fails before the demo row is stored (no part, a file that is no demo, a demo that was parsed in the meantime, the
     * storage failing): nothing was started. Once the row is stored the upload counts.
     */
    @PostMapping(path = "/{matchId}/demo/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DemoResponse upload(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId,
            MultipartHttpServletRequest request) throws IOException, MissingServletRequestPartException {
        Actor actor = access.current();
        service.requireUploadAllowed(actor, matchId);
        Reservation place = usage.reserve(actor, UsageKind.DEMO_UPLOAD);

        AtomicBoolean stored = new AtomicBoolean();
        try {
            // The body is read here, and not before.
            MultipartFile file = request.getFile(FILE_PART);
            if (file == null) {
                throw new MissingServletRequestPartException(FILE_PART);
            }
            requireDemoFile(file);
            try (InputStream content = file.getInputStream()) {
                return service.upload(actor, matchId, content, () -> stored.set(true));
            }
        } catch (IOException | MissingServletRequestPartException | RuntimeException e) {
            if (!stored.get()) {
                usage.release(place);
            }
            throw e;
        }
    }

    /**
     * Has the parsed demo of the match analyzed again, from the facts that are in the database. Needs the admin key or
     * a session; a user has to be in the roster of the match (403 otherwise) and can ask only for an analysis that is
     * missing, that is, while the demo is PARSED (409 otherwise), and each such request is one of their imports of the
     * day (429 {@code IMPORT_LIMIT_REACHED}). The answer is 202 with the demo as it is now; the
     * analysis runs in the background, so poll {@code GET .../demo} for the result.
     */
    @PostMapping("/{matchId}/demo/analyze")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DemoResponse requestAnalysis(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return service.requestAnalysis(access.current(), matchId);
    }

    @GetMapping("/{matchId}/demo")
    public DemoResponse get(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return service.get(matchId);
    }

    /** The part must carry a file with a demo's name and some content; whether the content is a demo is the parser's concern. */
    private static void requireDemoFile(MultipartFile file) {
        String name = file.getOriginalFilename();
        String lowerCase = name == null ? "" : name.toLowerCase(Locale.ROOT);
        if (DEMO_FILE_SUFFIXES.stream().noneMatch(lowerCase::endsWith)) {
            throw new BadRequestException("The file name must end with .dem, .dem.gz or .dem.zst");
        }
        if (file.isEmpty()) {
            throw new BadRequestException("The file is empty");
        }
    }
}
