package io.csfaceit.backend.common.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * The body of every error response: a stable machine-readable {@code code} and a human-readable {@code message}.
 *
 * @param retryAt when the request can succeed, for the one kind of answer that knows it: a limit per day that is
 *        reached (429). {@code null} for every other error, and then the field is not in the JSON at all.
 */
public record ApiError(String code, String message, @JsonInclude(JsonInclude.Include.NON_NULL) Instant retryAt) {

    public ApiError(String code, String message) {
        this(code, message, null);
    }
}
