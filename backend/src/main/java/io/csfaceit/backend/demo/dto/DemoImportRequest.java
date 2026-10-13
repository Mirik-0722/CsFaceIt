package io.csfaceit.backend.demo.dto;

/**
 * The optional body of {@code POST /api/v1/matches/{matchId}/demo/import}: the link to the demo file, or null to have
 * the demo fetched from FACEIT. The link can carry a signature, so it is left out of {@link #toString()}.
 */
public record DemoImportRequest(String url) {

    @Override
    public String toString() {
        return "DemoImportRequest[url=" + (url == null ? "null" : "(hidden)") + "]";
    }
}
