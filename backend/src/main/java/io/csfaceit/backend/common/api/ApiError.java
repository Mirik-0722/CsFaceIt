package io.csfaceit.backend.common.api;

/** The body of every error response: a stable machine-readable {@code code} and a human-readable {@code message}. */
public record ApiError(String code, String message) {
}
