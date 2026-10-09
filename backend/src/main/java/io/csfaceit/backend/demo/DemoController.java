package io.csfaceit.backend.demo;

import static io.csfaceit.backend.match.MatchController.MATCH_ID_MESSAGE;
import static io.csfaceit.backend.match.MatchController.MATCH_ID_PATTERN;

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

@RestController
@RequestMapping("/api/v1/matches")
@Validated
public class DemoController {

    /** The name of the multipart part that carries the demo. */
    static final String FILE_PART = "file";

    /** What the name of an uploaded demo ends with: raw, gzip or zstd. The content is checked by its bytes, not its name. */
    private static final List<String> DEMO_FILE_SUFFIXES = List.of(".dem", ".dem.gz", ".dem.zst");

    private final DemoService service;

    public DemoController(DemoService service) {
        this.service = service;
    }

    /** Needs the {@code X-API-Key} header: {@code SecurityConfig} protects every request that is not a GET or HEAD. */
    @PostMapping("/{matchId}/demo/import")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DemoResponse requestImport(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return service.requestImport(matchId);
    }

    /**
     * Takes the demo of the match as a file instead of downloading it from FACEIT. Needs the {@code X-API-Key} header
     * like every POST. The answer is 202 with the demo as it is once stored: STORED, and announced for parsing.
     */
    @PostMapping(path = "/{matchId}/demo/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DemoResponse upload(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId,
            @RequestPart(FILE_PART) MultipartFile file) throws IOException {
        requireDemoFile(file);
        try (InputStream content = file.getInputStream()) {
            return service.upload(matchId, content);
        }
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
