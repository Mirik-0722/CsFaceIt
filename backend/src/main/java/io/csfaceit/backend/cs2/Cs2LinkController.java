package io.csfaceit.backend.cs2;

import io.csfaceit.backend.auth.Access;
import io.csfaceit.backend.common.api.ApiError;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.cs2.Cs2LinkService.Linked;
import io.csfaceit.backend.cs2.Cs2LinkService.Refused;
import io.csfaceit.backend.cs2.Cs2Links.View;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /api/v1/cs2/link}: the signed-in player's link to their CS2 matchmaking history (see {@link Cs2LinkService}).
 *
 * <ul>
 *   <li>{@code POST} {@code {authCode, shareCode}}: 201 for a new link, 200 for one that replaced the earlier link, with
 *       {@code {state, linkedAt, checkedAt}}; 400 {@code VALIDATION_ERROR}, 422 {@code CS2_AUTH_CODE_REFUSED} or
 *       {@code CS2_SHARE_CODE_REFUSED}, 429 {@code CS2_LINK_LIMIT_REACHED}, 503 {@code CS2_STEAM_UNAVAILABLE}.
 *   <li>{@code GET}: 200 {@code {state, linkedAt, checkedAt}} or 404 {@code CS2_NOT_LINKED}.
 *   <li>{@code DELETE}: 204, also when there was no link.
 * </ul>
 *
 * All three answer 404 {@code CS2_DISABLED} while the feature is off, before anything else, and need a session: a
 * request without one is 401 (the {@code GET} too, although reads are open), and the admin key alone is 403
 * {@code FORBIDDEN}. The writes are under the cross-site rule of every session write. The authentication code is in the
 * body only, never in an answer.
 */
@RestController
@RequestMapping("/api/v1/cs2/link")
public class Cs2LinkController {

    /** What the endpoints show of a link; never the codes. */
    public record Cs2LinkResponse(Cs2Links.State state, Instant linkedAt, Instant checkedAt) {

        static Cs2LinkResponse of(View view) {
            return new Cs2LinkResponse(view.state(), view.linkedAt(), view.checkedAt());
        }
    }

    /** The body of {@code POST}. The authentication code is a secret, so it is left out of {@link #toString()}. */
    public record Cs2LinkRequest(String authCode, String shareCode) {

        @Override
        public String toString() {
            return "Cs2LinkRequest[authCode=(hidden), shareCode=" + shareCode + "]";
        }
    }

    private final Cs2LinkService links;
    private final Access access;

    public Cs2LinkController(Cs2LinkService links, Access access) {
        this.links = links;
        this.access = access;
    }

    @PostMapping
    public ResponseEntity<Cs2LinkResponse> link(@RequestBody(required = false) Cs2LinkRequest body) {
        requireEnabled();
        Linked linked = links.link(access.current(), body == null ? null : body.authCode(),
                body == null ? null : body.shareCode());
        return ResponseEntity.status(linked.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(Cs2LinkResponse.of(linked.link()));
    }

    @GetMapping
    public Cs2LinkResponse get() {
        requireEnabled();
        return Cs2LinkResponse.of(links.get(access.current()));
    }

    @DeleteMapping
    public ResponseEntity<Void> unlink() {
        requireEnabled();
        links.unlink(access.current());
        return ResponseEntity.noContent().build();
    }

    /** Answers a refusal of {@link Cs2LinkService} (422, 503) in the usual error shape. */
    @ExceptionHandler(Refused.class)
    ResponseEntity<ApiError> handleRefused(Refused refused) {
        return ResponseEntity.status(refused.getStatus()).body(new ApiError(refused.getCode(), refused.getMessage()));
    }

    private void requireEnabled() {
        if (!links.enabled()) {
            throw new NotFoundException(Cs2LinkService.CS2_DISABLED, "CS2 matchmaking is not switched on on this site");
        }
    }
}
