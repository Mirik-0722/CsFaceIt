package io.csfaceit.backend.common.log;

/**
 * Masks a SteamID for a log line: a SteamID is the identity of a real person, so a log keeps only its last four digits,
 * enough to tell two apart when reading the log of one match. Every log line that would name a SteamID, or a placeholder
 * player id {@code steam:<SteamID>}, goes through here.
 */
public final class SteamIds {

    private static final String PLACEHOLDER_PREFIX = "steam:";
    private static final int VISIBLE = 4;

    private SteamIds() {
    }

    /**
     * {@code 76561198000000001} becomes {@code …0001}, {@code steam:76561198000000001} becomes {@code steam:…0001}; a
     * value of four characters or fewer shows nothing but the ellipsis, and null shows as {@code null}.
     */
    public static String mask(String value) {
        if (value == null) {
            return "null";
        }
        String prefix = value.startsWith(PLACEHOLDER_PREFIX) ? PLACEHOLDER_PREFIX : "";
        String id = value.substring(prefix.length());
        return prefix + "…" + (id.length() > VISIBLE ? id.substring(id.length() - VISIBLE) : "");
    }

    /**
     * The id of a player row for a log line: a FACEIT id is shown as it is, a placeholder id {@code steam:<SteamID>}
     * (a player known from a demo only) is masked like a SteamID.
     */
    public static String maskPlayerId(String faceitId) {
        return faceitId != null && faceitId.startsWith(PLACEHOLDER_PREFIX) ? mask(faceitId) : faceitId;
    }
}
