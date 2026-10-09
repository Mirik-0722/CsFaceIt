package io.csfaceit.backend.demo;

import static io.csfaceit.backend.match.MatchController.MATCH_ID_MESSAGE;
import static io.csfaceit.backend.match.MatchController.MATCH_ID_PATTERN;

import io.csfaceit.backend.demo.dto.DemoResponse;
import jakarta.validation.constraints.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/matches")
@Validated
public class DemoController {

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

    @GetMapping("/{matchId}/demo")
    public DemoResponse get(
            @PathVariable @Pattern(regexp = MATCH_ID_PATTERN, message = MATCH_ID_MESSAGE) String matchId) {
        return service.get(matchId);
    }
}
