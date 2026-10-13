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
    DOWNLOAD_NEEDS_ACCESS
}
