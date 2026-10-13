package io.csfaceit.backend.clip;

/**
 * Why a clip failed, or why its last attempt did, for the reasons the backend itself finds and words: a page translates
 * them instead of showing {@code clips.error}, which is an English sentence for the logs. It is stored in
 * {@code clips.error_code} and shown as {@code errorCode} in the API; a reason the recorder reports is free text of its
 * own and has no code. The names are part of the API: a client switches on them, and a name is never reused for another
 * reason.
 */
public enum ClipErrorCode {

    /** No sign of life from the recorder for {@code clip.stale-after}: the clip was taken back (see StaleClipJob). */
    RECORDER_STOPPED("The recorder stopped responding"),

    /** The recorder gave a clip up and sent no text of why. */
    NO_REASON("The recorder gave no reason"),

    /** The demo of the clip's match has no stored file any more, so the clip cannot be recorded. Not retried. */
    DEMO_GONE("The demo file is no longer stored"),

    /** The player of the clip has no SteamID, which the recorder needs to follow him. Not retried. */
    STEAM_ID_UNKNOWN("The player's Steam ID is not known");

    private final String sentence;

    ClipErrorCode(String sentence) {
        this.sentence = sentence;
    }

    /** The English sentence stored in {@code clips.error} next to the code. */
    public String sentence() {
        return sentence;
    }

    /** The code of that name, or {@code null} for no name and for one this version does not know. */
    public static ClipErrorCode fromName(String name) {
        if (name == null) {
            return null;
        }
        try {
            return valueOf(name);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
