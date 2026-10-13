package io.csfaceit.backend.demo;

import static io.csfaceit.backend.match.MatchController.MATCH_ID_MESSAGE;
import static io.csfaceit.backend.match.MatchController.MATCH_ID_PATTERN;

import io.csfaceit.backend.auth.Access;
import io.csfaceit.backend.common.api.BadRequestException;
import io.csfaceit.backend.demo.dto.DemoResponse;
import jakarta.validation.constraints.Pattern;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

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

    public DemoController(DemoService service, Access access) {
        this.service = service;
        this.access = access;
    }

    /** Needs the admin key or a session; a user has to be in the roster of the match (403 otherwise). */
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
     */
    @PostMapping(path = "/{matchId}/demo/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DemoResponse upload(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId,
            @RequestPart(FILE_PART) MultipartFile file) throws IOException {
        requireDemoFile(file);
        try (InputStream content = file.getInputStream()) {
            return service.upload(access.current(), matchId, content);
        }
    }

    /**
     * Has the parsed demo of the match analyzed again, from the facts that are in the database. Needs the admin key or
     * a session; a user has to be in the roster of the match (403 otherwise) and can ask only for an analysis that is
     * missing, that is, while the demo is PARSED (409 otherwise). The answer is 202 with the demo as it is now; the
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
