package io.csfaceit.backend.clip;

import io.csfaceit.backend.analysis.api.HighlightQueryService;
import io.csfaceit.backend.analysis.api.dto.HighlightResponse;
import io.csfaceit.backend.clip.ClipPersistence.HighlightKey;
import io.csfaceit.backend.clip.dto.ClipResponse;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.common.api.TooManyRequestsException;
import io.csfaceit.backend.demo.Demo;
import io.csfaceit.backend.demo.DemoRepository;
import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.player.Player;
import io.csfaceit.backend.player.PlayerRepository;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Takes the requests for clips. Like {@code DemoService} it opens no transaction itself: the facts are read and the
 * segments worked out with none open, and the short database steps are the transactions of {@link ClipPersistence}.
 * What a request answers with, and every other read of clips, is {@link ClipQueryService}'s.
 *
 * <p>A clip is requested for a highlight and a quality. The highlight is read only through
 * {@link HighlightQueryService#find}, which knows when a highlight may be served (while the demo of its match is
 * {@code ANALYZED}); the clip is tied to it by the highlight's natural key and not by its id, so a new analysis of the
 * demo does not cut the clip off from its highlight.
 */
@Service
public class ClipService {

    /** What a request for a clip came to: the clip, and whether this request is the one that queued it. */
    public record ClipCreation(ClipResponse clip, boolean created) {
    }

    private static final String HIGHLIGHT_NOT_FOUND = "HIGHLIGHT_NOT_FOUND";
    private static final String DEMO_NOT_AVAILABLE = "DEMO_NOT_AVAILABLE";
    private static final String PLAYER_STEAM_ID_UNKNOWN = "PLAYER_STEAM_ID_UNKNOWN";
    private static final String CLIP_QUEUE_FULL = "CLIP_QUEUE_FULL";
    private static final String CLIP_TOO_LONG = "CLIP_TOO_LONG";

    private static final Logger log = LoggerFactory.getLogger(ClipService.class);

    private final HighlightQueryService highlights;
    private final MatchRepository matches;
    private final PlayerRepository players;
    private final DemoRepository demos;
    private final ClipFacts facts;
    private final ClipPersistence persistence;
    private final ClipQueryService queries;
    private final ClipProperties properties;

    public ClipService(HighlightQueryService highlights, MatchRepository matches, PlayerRepository players,
                       DemoRepository demos, ClipFacts facts, ClipPersistence persistence, ClipQueryService queries,
                       ClipProperties properties) {
        this.highlights = highlights;
        this.matches = matches;
        this.players = players;
        this.demos = demos;
        this.facts = facts;
        this.persistence = persistence;
        this.queries = queries;
        this.properties = properties;
    }

    /**
     * Queues the clip of a highlight at a quality, or answers with the clip that already stands for it. The checks
     * come in this order, and the first that fails ends the request:
     * <ol>
     *   <li>the highlight is read (see {@link HighlightQueryService#find}): there is none, or its demo is not
     *       {@code ANALYZED}
     *   <li>a clip of this highlight and quality that is not {@code FAILED} exists: it is the answer, whatever became
     *       of the demo file since (the files are removed after a while, the clips outlive them) and however long
     *       the queue is
     *   <li>the file of the demo is stored, and the player's SteamID is known: a recorder follows a player by it
     *   <li>the queue has room
     *   <li>the segments, worked out from the player's kills in the highlight's window, are not longer than
     *       {@code clip.max-duration-seconds}
     * </ol>
     * Repeating a request, also in parallel, therefore leaves one clip. The queue limit is soft: the count and the
     * insert are not one step, so two requests at the limit may both get in.
     *
     * @throws NotFoundException {@code HIGHLIGHT_NOT_FOUND}
     * @throws ConflictException {@code DEMO_NOT_AVAILABLE}, {@code PLAYER_STEAM_ID_UNKNOWN} or {@code CLIP_TOO_LONG}
     * @throws TooManyRequestsException {@code CLIP_QUEUE_FULL}
     */
    public ClipCreation requestHighlightClip(long highlightId, ClipQuality quality) {
        HighlightResponse highlight = highlights.find(highlightId).orElseThrow(() -> highlightNotFound(highlightId));
        // The highlight was read from rows that join its match, its player and its demo, so they are there; a row that
        // has gone since is the highlight having gone.
        Match match = matches.findByFaceitMatchId(highlight.matchId())
                .orElseThrow(() -> highlightNotFound(highlightId));
        Player player = players.findByFaceitId(highlight.playerId())
                .orElseThrow(() -> highlightNotFound(highlightId));

        HighlightKey key = new HighlightKey(match.getId(), player.getId(), highlight.type(), highlight.roundNumber(),
                highlight.tickStart(), quality);
        Optional<Long> existing = persistence.findLiveHighlightClip(key);
        if (existing.isPresent()) {
            return new ClipCreation(queries.summary(existing.get()), false);
        }

        int tickRate = tickRateOfRecordableDemo(match, player);
        if (persistence.countQueued() >= properties.maxQueued()) {
            throw new TooManyRequestsException(CLIP_QUEUE_FULL,
                    "The clip queue is full (" + properties.maxQueued() + " clips are waiting), try again later");
        }
        List<Integer> killTicks = facts.killTicks(match.getId(), player.getId(), highlight.roundNumber(),
                highlight.tickStart(), highlight.tickEnd());
        List<ClipSegment> segments = SegmentBuilder.build(killTicks, highlight.tickStart(), highlight.tickEnd(),
                tickRate, properties);
        rejectIfTooLong(segments, tickRate);

        long clipId;
        try {
            clipId = persistence.queueHighlightClip(key, highlight.tickEnd(), properties.fps(), segments);
        } catch (DataIntegrityViolationException e) {
            // A concurrent request queued the same clip between the look above and the insert, and the unique index
            // let only one of them in. The loser's transaction is aborted; the clip it was after is the winner's.
            Optional<Long> winner = persistence.findLiveHighlightClip(key);
            if (winner.isEmpty()) {
                throw e;
            }
            log.info("Lost a concurrent request for the clip of highlight {} at {}, answering with clip {}",
                    highlightId, quality.label(), winner.get());
            return new ClipCreation(queries.summary(winner.get()), false);
        }
        log.info("Queued clip {} at {} for highlight {} ({} of {}, round {}): {} segment(s), {} ticks", clipId,
                quality.label(), highlightId, highlight.type(), highlight.matchId(), highlight.roundNumber(),
                segments.size(), SegmentBuilder.totalTicks(segments));
        return new ClipCreation(queries.summary(clipId), true);
    }

    /**
     * The tick rate of the demo of the match, provided a recorder can be given its file: a stored file, and a demo
     * that is parsed (or analyzed). Then the player: a recorder follows him by his SteamID, which a player known only
     * from FACEIT may not have.
     *
     * @throws ConflictException {@code DEMO_NOT_AVAILABLE} or {@code PLAYER_STEAM_ID_UNKNOWN}
     */
    private int tickRateOfRecordableDemo(Match match, Player player) {
        Demo demo = demos.findByMatchId(match.getId())
                .filter(ClipFacts::hasStoredFile)
                .orElseThrow(() -> new ConflictException(DEMO_NOT_AVAILABLE,
                        "The demo file of match " + match.getFaceitMatchId() + " is not stored (any more)"));
        if (player.getSteamId() == null || player.getSteamId().isBlank()) {
            throw new ConflictException(PLAYER_STEAM_ID_UNKNOWN, "The SteamID of player " + player.getFaceitId()
                    + " is not known, so he cannot be followed in a demo");
        }
        return ClipFacts.tickRate(demo.getTickRate());
    }

    private void rejectIfTooLong(List<ClipSegment> segments, int tickRate) {
        long ticks = SegmentBuilder.totalTicks(segments);
        if (ticks > (long) properties.maxDurationSeconds() * tickRate) {
            // Rounded up, so that the length named is above the limit named.
            long seconds = (long) Math.ceil((double) ticks / tickRate);
            throw new ConflictException(CLIP_TOO_LONG, "The clip would be " + seconds
                    + " seconds long; the longest allowed is " + properties.maxDurationSeconds() + " seconds");
        }
    }

    private static NotFoundException highlightNotFound(long highlightId) {
        return new NotFoundException(HIGHLIGHT_NOT_FOUND, "Highlight not found: " + highlightId);
    }
}
