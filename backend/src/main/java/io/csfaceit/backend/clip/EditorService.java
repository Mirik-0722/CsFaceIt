package io.csfaceit.backend.clip;

import io.csfaceit.backend.analysis.api.HighlightQueryService;
import io.csfaceit.backend.analysis.facts.Side;
import io.csfaceit.backend.clip.ClipFacts.EditorKillRow;
import io.csfaceit.backend.clip.dto.EditorSource;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.demo.Demo;
import io.csfaceit.backend.demo.DemoRepository;
import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.player.Player;
import io.csfaceit.backend.player.PlayerRepository;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;

/**
 * Reads what the montage editor is built from ({@link EditorSource}): the player's kills of an enemy in a match, round
 * by round, his highlights there and the rules of a montage. It only reads the database; the order of a montage is
 * {@link ClipService#requestMontage}, which holds a montage to the same rules ({@link #MAX_SEGMENTS} and the rest).
 *
 * <p>The editor is offered while a montage can be ordered: the demo's file is stored and the demo is parsed (or
 * analyzed), the rule a recorder is given a demo by ({@link ClipFacts#hasStoredFile}).
 */
@Service
public class EditorService {

    /** The most segments a montage may have. */
    public static final int MAX_SEGMENTS = 30;

    /** The longest one segment of a montage may be, in seconds of the demo. */
    public static final int MAX_SEGMENT_SECONDS = 60;

    /** The longest title of a montage, in characters. */
    public static final int TITLE_MAX_LENGTH = 60;

    private static final String MATCH_NOT_FOUND = "MATCH_NOT_FOUND";
    private static final String PLAYER_NOT_IN_MATCH = "PLAYER_NOT_IN_MATCH";
    private static final String DEMO_NOT_AVAILABLE = "DEMO_NOT_AVAILABLE";

    private final MatchRepository matches;
    private final PlayerRepository players;
    private final DemoRepository demos;
    private final ClipFacts facts;
    private final HighlightQueryService highlights;
    private final ClipProperties properties;

    public EditorService(MatchRepository matches, PlayerRepository players, DemoRepository demos, ClipFacts facts,
                         HighlightQueryService highlights, ClipProperties properties) {
        this.matches = matches;
        this.players = players;
        this.demos = demos;
        this.facts = facts;
        this.highlights = highlights;
        this.properties = properties;
    }

    /**
     * The editor's source for a player in a match. The checks come in this order: the match is known to the database
     * (FACEIT is not asked), its demo can be recorded from, and the player is known and played in the match. A player
     * who played and killed nobody has no rounds.
     *
     * @param faceitMatchId the FACEIT match id
     * @param faceitPlayerId the FACEIT player id, or {@code steam:<SteamID>}
     * @throws NotFoundException {@code MATCH_NOT_FOUND} or {@code PLAYER_NOT_IN_MATCH}
     * @throws ConflictException {@code DEMO_NOT_AVAILABLE}
     */
    public EditorSource source(String faceitMatchId, String faceitPlayerId) {
        Match match = matches.findByFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new NotFoundException(MATCH_NOT_FOUND, "Match not found: " + faceitMatchId));
        Demo demo = demos.findByMatchId(match.getId())
                .filter(ClipFacts::hasStoredFile)
                .orElseThrow(() -> new ConflictException(DEMO_NOT_AVAILABLE, "The demo of match " + faceitMatchId
                        + " is not parsed or its file is not stored (any more)"));
        Player player = players.findByFaceitId(faceitPlayerId)
                .filter(found -> facts.playsIn(match.getId(), found.getId()))
                .orElseThrow(() -> new NotFoundException(PLAYER_NOT_IN_MATCH,
                        "The player did not play in match " + faceitMatchId));

        List<EditorSource.Highlight> playerHighlights = highlights.forMatch(faceitMatchId, null, faceitPlayerId)
                .stream()
                .map(h -> new EditorSource.Highlight(h.id(), h.type(), h.roundNumber(), h.tickStart(), h.tickEnd()))
                .toList();
        return new EditorSource(faceitMatchId, match.getMapName(), ClipFacts.tickRate(demo.getTickRate()),
                new EditorSource.Player(player.getFaceitId(), player.getNickname()),
                rounds(facts.editorKills(match.getId(), player.getId())), playerHighlights, limits());
    }

    /** The rules of a montage, as the editor is told them. */
    public EditorSource.Limits limits() {
        return new EditorSource.Limits(properties.preSeconds(), properties.postSeconds(), MAX_SEGMENT_SECONDS,
                properties.maxDurationSeconds(), MAX_SEGMENTS,
                Arrays.stream(ClipQuality.values()).map(ClipQuality::label).toList(), ClipAspect.labels(),
                TITLE_MAX_LENGTH, properties.musicTracks());
    }

    /** The kills grouped into their rounds, in the order they come in (by round, then by tick). */
    private static List<EditorSource.Round> rounds(List<EditorKillRow> kills) {
        Map<Integer, List<EditorKillRow>> byRound = new LinkedHashMap<>();
        for (EditorKillRow kill : kills) {
            byRound.computeIfAbsent(kill.roundNumber(), number -> new ArrayList<>()).add(kill);
        }
        return byRound.values().stream().map(EditorService::round).toList();
    }

    /** One round from its kills; the side is the first one a kill of the round names. */
    private static EditorSource.Round round(List<EditorKillRow> kills) {
        EditorKillRow first = kills.get(0);
        Side side = kills.stream().map(kill -> Side.fromDatabase(kill.side()))
                .filter(Objects::nonNull).findFirst().orElse(null);
        return new EditorSource.Round(first.roundNumber(), first.roundStartTick(), first.roundEndTick(),
                side == null ? null : side.name(),
                kills.stream().map(kill -> new EditorSource.Kill(kill.tick(), kill.weapon(), kill.headshot(),
                        kill.wallbang(), kill.noscope(), kill.throughSmoke(), kill.victimNickname())).toList());
    }
}
