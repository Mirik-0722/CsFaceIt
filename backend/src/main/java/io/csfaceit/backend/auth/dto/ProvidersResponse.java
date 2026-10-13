package io.csfaceit.backend.auth.dto;

/**
 * Which ways of signing in this deployment offers: Steam always; FACEIT is {@code false} until its flow is written (see
 * {@code AuthController#providers}), and will then be true only while its OAuth client id is set.
 */
public record ProvidersResponse(boolean steam, boolean faceit) {
}
