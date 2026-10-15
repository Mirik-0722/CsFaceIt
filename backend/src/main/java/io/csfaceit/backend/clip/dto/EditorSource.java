package io.csfaceit.backend.clip.dto;

import io.csfaceit.backend.analysis.highlight.HighlightType;
import io.csfaceit.backend.clip.ClipProperties.MusicTrack;
import java.util.List;

/**
 * What the montage editor is built from: one player's kills in one match, round by round, his highlights there, and
 * the rules a montage of them has to keep.
 *
 * <p>{@code matchId} is the FACEIT match id, {@code tickRate} the ticks per second of the demo, which every tick here is
 * in. {@code rounds} are only those in which the player killed an enemy, by number; each holds its kills by tick.
 * {@code highlights} are the player's highlights in the match while its demo is analyzed, and empty otherwise.
 */
public record EditorSource(
        String matchId,
        String mapName,
        int tickRate,
        Player player,
        List<Round> rounds,
        List<Highlight> highlights,
        Limits limits) {

    /** {@code playerId} is the FACEIT player id, or {@code steam:<SteamID>} for a player known only from a demo. */
    public record Player(String playerId, String nickname) {
    }

    /**
     * One round, {@code startTick..endTick}, with the player's kills of an enemy in it. {@code side} is {@code "CT"} or
     * {@code "T"}, the side he played the round on, and {@code null} when the facts do not say.
     */
    public record Round(int number, int startTick, int endTick, String side, List<Kill> kills) {
    }

    /** One kill of an enemy; {@code weapon} is the raw name from the demo. */
    public record Kill(int tick, String weapon, boolean headshot, boolean wallbang, boolean noscope,
                       boolean throughSmoke, String victimNickname) {
    }

    /** A highlight of the player, by its id and its window in the demo. */
    public record Highlight(long id, HighlightType type, int roundNumber, int tickStart, int tickEnd) {
    }

    /**
     * The rules of a montage: how far a segment the editor proposes reaches before and after a kill, how long one
     * segment and the whole video may be (a slow-motion segment counts twice, the intro its seconds), how many
     * segments and how long a title, and the qualities, frame rates, shapes and music to choose from.
     */
    public record Limits(int preSeconds, int postSeconds, int maxSegmentSeconds, int maxDurationSeconds,
                         int maxSegments, List<String> qualities, List<Integer> frameRates, List<String> aspects,
                         int titleMaxLength, List<MusicTrack> musicTracks) {
    }
}
