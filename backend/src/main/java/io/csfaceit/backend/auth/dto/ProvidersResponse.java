package io.csfaceit.backend.auth.dto;

/** Which ways of signing in this deployment offers: Steam always, FACEIT only while its OAuth client id is set. */
public record ProvidersResponse(boolean steam, boolean faceit) {
}
