package io.csfaceit.backend.usage;

/**
 * What a signed-in player does that counts against a limit per day. The name is what {@code user_actions.kind} holds
 * (16 characters at most), the code is what the API answers with when the limit is reached.
 */
public enum UsageKind {

    /** A demo file sent to {@code POST .../demo/upload}. */
    DEMO_UPLOAD("UPLOAD_LIMIT_REACHED", "demo uploads"),

    /** An import that was queued by {@code POST .../demo/import}, or an analysis asked for by {@code .../demo/analyze}. */
    DEMO_IMPORT("IMPORT_LIMIT_REACHED", "demo imports"),

    /** A clip that was queued: an order of a highlight's clip or of a compilation, or the retry of a failed clip. */
    CLIP_ORDER("CLIP_LIMIT_REACHED", "clip orders"),

    /**
     * An attempt to link a CS2 account ({@code POST /api/v1/cs2/link}) that Steam was asked about, whatever Steam said: the
     * limit bounds how often an authentication code can be tried.
     */
    CS2_LINK("CS2_LINK_LIMIT_REACHED", "CS2 link attempts");

    private final String limitCode;
    private final String plural;

    UsageKind(String limitCode, String plural) {
        this.limitCode = limitCode;
        this.plural = plural;
    }

    /** The code of the 429 that says this limit is reached. */
    public String limitCode() {
        return limitCode;
    }

    /** What is counted, in words, for a message: "clip orders". */
    public String plural() {
        return plural;
    }
}
