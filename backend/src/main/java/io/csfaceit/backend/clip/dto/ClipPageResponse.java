package io.csfaceit.backend.clip.dto;

import java.util.List;

/** A page of clips; {@code offset} and {@code limit} echo the request. */
public record ClipPageResponse(List<ClipResponse> items, int offset, int limit) {
}
