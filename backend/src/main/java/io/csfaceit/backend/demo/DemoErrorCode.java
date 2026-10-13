package io.csfaceit.backend.demo;

/**
 * Why a demo FAILED, for the reasons that a page explains in its own words instead of showing {@code demos.error}, which
 * is an English sentence for the logs. It is stored in {@code demos.error_code} and shown as {@code errorCode} in the
 * API; every other failure has no code. The names are part of the API: a client switches on them.
 */
public enum DemoErrorCode {

    /**
     * FACEIT did not let this site download the demo: its Downloads API refused the token (or the site has none), or
     * the demo address is FACEIT's private cloud, which does not answer anyone but the Downloads API. Another try
     * changes nothing; the demo can be fetched from the match's room on FACEIT and uploaded.
     */
    DOWNLOAD_NEEDS_ACCESS,

    /**
     * The import of the demo from FACEIT failed on every attempt (its message was dead-lettered), for a reason that is
     * not FACEIT refusing the site. The demo can be fetched from the match's room on FACEIT and uploaded.
     */
    IMPORT_FAILED,

    /** The parsing of the demo file failed on every attempt, or the parser gave the file up: it may be damaged. */
    PARSE_FAILED,

    /**
     * The analysis of a parsed demo failed on every attempt. The demo stays PARSED with this code next to its error;
     * starting the analysis again clears both.
     */
    ANALYSIS_FAILED,

    /**
     * The demo was parsed, but its players are not the players of the match it was uploaded or imported for: fewer than
     * the allowed share of the roster's players whose SteamID FACEIT gives are among them. It is another game's file.
     * The demo is FAILED and nothing of it was analyzed, so the statistics and the highlights of the match are not
     * replaced; uploading or importing the right file starts over.
     */
    WRONG_MATCH
}
