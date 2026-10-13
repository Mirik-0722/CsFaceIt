package io.csfaceit.backend.clip;

import io.csfaceit.backend.analysis.api.HighlightQueryService;
import io.csfaceit.backend.analysis.api.dto.HighlightResponse;
import io.csfaceit.backend.auth.Access;
import io.csfaceit.backend.auth.Actor;
import io.csfaceit.backend.auth.ForbiddenException;
import io.csfaceit.backend.clip.ClipFacts.RoundKills;
import io.csfaceit.backend.clip.ClipPersistence.CompilationKey;
import io.csfaceit.backend.clip.ClipPersistence.FailedClip;
import io.csfaceit.backend.clip.ClipPersistence.HighlightKey;
import io.csfaceit.backend.clip.dto.ClipResponse;
import io.csfaceit.backend.clip.dto.MontageRequest;
import io.csfaceit.backend.common.api.BadRequestException;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.common.api.TooManyRequestsException;
import io.csfaceit.backend.common.log.SteamIds;
import io.csfaceit.backend.demo.Demo;
import io.csfaceit.backend.demo.DemoRepository;
import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.player.Player;
import io.csfaceit.backend.player.PlayerRepository;
import io.csfaceit.backend.storage.StorageException;
import io.csfaceit.backend.storage.StorageService;
import io.csfaceit.backend.usage.QuotaExceededException;
import io.csfaceit.backend.usage.UsageKind;
import io.csfaceit.backend.usage.UsageService;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Takes the requests for clips, retries and deletes them. Like {@code DemoService} it opens no transaction itself: the
 * facts are read and the segments worked out with none open, and the short database steps are the transactions of
 * {@link ClipPersistence}. What a request answers with, and every other read of clips, is {@link ClipQueryService}'s.
 *
 * <p>A clip is requested for a highlight and a quality. The highlight is read only through
 * {@link HighlightQueryService#find}, which knows when a highlight may be served (while the demo of its match is
 * {@code ANALYZED}); the clip is tied to it by the highlight's natural key and not by its id, so a new analysis of the
 * demo does not cut the clip off from its highlight.
 *
 * <p>A compilation is requested for a player and a quality in a match and is made of every kill of the player in the
 * match, round by round. No highlight is behind it, so the demo is read from the parser's facts alone.
 *
 * <p>A montage is requested for a player, a quality and the segments and options he chose in the editor
 * ({@link EditorService}). The segments are his, in his order; they are only checked against the demo, never worked
 * out, sorted or merged here. Every order of a montage is a new clip.
 *
 * <p>Every request is made by an {@link Actor}, and {@link Access} is asked whether the actor may: the admin key and an
 * administrator always; a user orders clips of their own player only, and deletes and retries only the clips they
 * ordered. A clip ordered by a session records the user ({@code clips.requested_by}); one ordered with the admin key
 * records nobody. Asking again for a clip that exists answers with it and leaves whoever ordered it as they were.
 *
 * <p>A user orders so many clips per day ({@link UsageService}, {@link UsageKind#CLIP_ORDER}). An order is counted only
 * when it queues a new clip, and the retry of a failed clip is such an order; asking again for a clip that exists is
 * not counted, and deleting a clip gives nothing back. The place is taken in the transaction that writes the clip, as
 * the last thing that can refuse: every other refusal of an order comes before it, so a request that would be refused
 * anyway neither uses a place nor learns that the limit is reached.
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
    private static final String MATCH_NOT_FOUND = "MATCH_NOT_FOUND";
    private static final String PLAYER_NOT_FOUND = "PLAYER_NOT_FOUND";
    private static final String NO_KILLS = "NO_KILLS";
    private static final String CLIP_NOT_FOUND = "CLIP_NOT_FOUND";
    private static final String INVALID_SEGMENTS = "INVALID_SEGMENTS";
    private static final String INVALID_MONTAGE_OPTION = "INVALID_MONTAGE_OPTION";

    /** The options of a montage whose row lost them, which no montage ordered here does: no title, intro or music. */
    private static final MontageOptions NO_OPTIONS = new MontageOptions(null, ClipAspect.LANDSCAPE, false, null);

    /** The owner check of a delete that nobody asked for: the clean-up of old clips removes every clip alike. */
    private static final Consumer<Long> ANY_OWNER = requestedBy -> {
    };

    private static final Logger log = LoggerFactory.getLogger(ClipService.class);

    private final HighlightQueryService highlights;
    private final MatchRepository matches;
    private final PlayerRepository players;
    private final DemoRepository demos;
    private final ClipFacts facts;
    private final ClipPersistence persistence;
    private final ClipQueryService queries;
    private final ClipProperties properties;
    private final StorageService storage;
    private final ClipMetrics metrics;
    private final Access access;
    private final UsageService usage;

    public ClipService(HighlightQueryService highlights, MatchRepository matches, PlayerRepository players,
                       DemoRepository demos, ClipFacts facts, ClipPersistence persistence, ClipQueryService queries,
                       ClipProperties properties, StorageService storage, ClipMetrics metrics, Access access,
                       UsageService usage) {
        this.highlights = highlights;
        this.matches = matches;
        this.players = players;
        this.demos = demos;
        this.facts = facts;
        this.persistence = persistence;
        this.queries = queries;
        this.properties = properties;
        this.storage = storage;
        this.metrics = metrics;
        this.access = access;
        this.usage = usage;
    }

    /**
     * Queues the clip of a highlight at a quality, or answers with the clip that already stands for it. The checks
     * come in this order, and the first that fails ends the request:
     * <ol>
     *   <li>the highlight is read (see {@link HighlightQueryService#find}): there is none, or its demo is not
     *       {@code ANALYZED}
     *   <li>the highlight's player is the actor's own (a user; the admin key and an administrator order for anyone)
     *   <li>a clip of this highlight and quality that is not {@code FAILED} exists: it is the answer, whatever became
     *       of the demo file since (the files are removed after a while, the clips outlive them) and however long
     *       the queue is
     *   <li>the file of the demo is stored, and the player's SteamID is known: a recorder follows a player by it
     *   <li>the queue has room
     *   <li>the segments, worked out from the player's kills in the highlight's window, are not longer than
     *       {@code clip.max-duration-seconds}
     *   <li>the actor has a clip order left today (a user; the admin key and an administrator are not limited)
     * </ol>
     * Repeating a request, also in parallel, therefore leaves one clip. The queue limit is soft: the count and the
     * insert are not one step, so two requests at the limit may both get in.
     *
     * @param actor who orders; the clip that is queued records its user
     * @throws NotFoundException {@code HIGHLIGHT_NOT_FOUND}
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_YOUR_PLAYER}
     * @throws ConflictException {@code DEMO_NOT_AVAILABLE}, {@code PLAYER_STEAM_ID_UNKNOWN} or {@code CLIP_TOO_LONG}
     * @throws TooManyRequestsException {@code CLIP_QUEUE_FULL}
     * @throws QuotaExceededException {@code CLIP_LIMIT_REACHED}
     */
    public ClipCreation requestHighlightClip(Actor actor, long highlightId, ClipQuality quality) {
        HighlightResponse highlight = highlights.find(highlightId).orElseThrow(() -> highlightNotFound(highlightId));
        access.requireOwnPlayer(actor, highlight.playerId());
        // The highlight was read from rows that join its match, its player and its demo, so they are there; a row that
        // has gone since is the highlight having gone.
        Match match = matches.findByFaceitMatchId(highlight.matchId())
                .orElseThrow(() -> highlightNotFound(highlightId));
        Player player = players.findByFaceitId(highlight.playerId())
                .orElseThrow(() -> highlightNotFound(highlightId));

        HighlightKey key = new HighlightKey(match.getId(), player.getId(), highlight.type(), highlight.roundNumber(),
                highlight.tickStart(), quality);
        return orderHighlightClip(key, highlight.tickEnd(), match, player, actor.userId(), actor);
    }

    /**
     * The clip that stands for the key, or a new one in the queue: the checks of {@link #requestHighlightClip} from the
     * second on, for an order and for a retry alike.
     *
     * @param tickEnd the last tick of the highlight (its first is in the key)
     * @param requestedBy who a new clip is recorded for; an existing one keeps whoever ordered it
     * @param actor who asks: a new clip counts against their limit per day, and the answer is for them (see
     *        {@link ClipResponse#mine})
     */
    private ClipCreation orderHighlightClip(HighlightKey key, int tickEnd, Match match, Player player,
                                            Long requestedBy, Actor actor) {
        Long viewerId = actor.userId();
        Optional<Long> existing = persistence.findLiveHighlightClip(key);
        if (existing.isPresent()) {
            return new ClipCreation(queries.summary(existing.get(), viewerId), false);
        }

        int tickRate = tickRateOfRecordableDemo(match, player);
        rejectIfQueueFull();
        List<Integer> killTicks = facts.killTicks(match.getId(), player.getId(), key.roundNumber(), key.tickStart(),
                tickEnd);
        List<ClipSegment> segments = SegmentBuilder.build(killTicks, key.tickStart(), tickEnd, tickRate, properties);
        rejectIfTooLong(SegmentBuilder.totalTicks(segments), tickRate);

        long clipId;
        try {
            clipId = persistence.queueHighlightClip(key, tickEnd, properties.fps(), segments, requestedBy,
                    () -> usage.reserve(actor, UsageKind.CLIP_ORDER));
        } catch (DataIntegrityViolationException | QuotaExceededException e) {
            // A concurrent request queued the same clip between the look above and the insert, and the unique index
            // let only one of them in. The loser's transaction is aborted, and the place it took for the order with
            // it; the clip it was after is the winner's. The same when the winner took the actor's last place and
            // this request was refused one for it: the clip stands, and asking for a clip that stands is not counted.
            Optional<Long> winner = persistence.findLiveHighlightClip(key);
            if (winner.isEmpty()) {
                throw e;
            }
            log.info("Lost a concurrent request for the clip of the {} in round {} of match {} at {}, answering with "
                    + "clip {}", key.type(), key.roundNumber(), match.getFaceitMatchId(), key.quality().label(),
                    winner.get());
            return new ClipCreation(queries.summary(winner.get(), viewerId), false);
        }
        metrics.requested(ClipKind.HIGHLIGHT);
        log.info("Queued clip {} at {} for the {} in round {} of match {}: {} segment(s), {} ticks", clipId,
                key.quality().label(), key.type(), key.roundNumber(), match.getFaceitMatchId(), segments.size(),
                SegmentBuilder.totalTicks(segments));
        return new ClipCreation(queries.summary(clipId, viewerId), true);
    }

    /**
     * Queues the compilation of a player's kills in a match at a quality, or answers with the compilation that already
     * stands for them: one video of every kill of an enemy the player made in the match, round by round. The checks
     * come in this order, and the first that fails ends the request:
     * <ol>
     *   <li>the player is the actor's own (a user; the admin key and an administrator order for anyone)
     *   <li>the match, and then the player, are known to the database (FACEIT is not asked)
     *   <li>a compilation of this match, player and quality that is not {@code FAILED} exists: it is the answer,
     *       whatever became of the demo file since and however long the queue is
     *   <li>the file of the demo is stored, and the player's SteamID is known, as for the clip of a highlight; the demo
     *       need only be {@code PARSED}, since the kills are the parser's facts and no highlight is read
     *   <li>the player made a kill of an enemy in the match
     *   <li>the queue has room
     *   <li>the segments, worked out round by round from his kills, are not longer than
     *       {@code clip.max-duration-seconds}
     *   <li>the actor has a clip order left today (a user; the admin key and an administrator are not limited)
     * </ol>
     * Repeating a request, also in parallel, therefore leaves one compilation. The queue limit is soft, as for a
     * highlight.
     *
     * @param actor who orders; the clip that is queued records its user
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_YOUR_PLAYER}
     * @throws NotFoundException {@code MATCH_NOT_FOUND} or {@code PLAYER_NOT_FOUND}
     * @throws ConflictException {@code DEMO_NOT_AVAILABLE}, {@code PLAYER_STEAM_ID_UNKNOWN}, {@code NO_KILLS} or
     *         {@code CLIP_TOO_LONG}
     * @throws TooManyRequestsException {@code CLIP_QUEUE_FULL}
     * @throws QuotaExceededException {@code CLIP_LIMIT_REACHED}
     */
    public ClipCreation requestCompilation(Actor actor, String faceitMatchId, String faceitPlayerId,
                                           ClipQuality quality) {
        access.requireOwnPlayer(actor, faceitPlayerId);
        Match match = matches.findByFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new NotFoundException(MATCH_NOT_FOUND, "Match not found: " + faceitMatchId));
        Player player = players.findByFaceitId(faceitPlayerId)
                .orElseThrow(() -> new NotFoundException(PLAYER_NOT_FOUND, "Player not found: " + faceitPlayerId));

        CompilationKey key = new CompilationKey(match.getId(), player.getId(), quality);
        return orderCompilation(key, match, player, actor.userId(), actor);
    }

    /**
     * The compilation that stands for the key, or a new one in the queue: the checks of {@link #requestCompilation}
     * from the third on, for an order and for a retry alike.
     *
     * @param requestedBy who a new clip is recorded for; an existing one keeps whoever ordered it
     * @param actor who asks: a new clip counts against their limit per day, and the answer is for them (see
     *        {@link ClipResponse#mine})
     */
    private ClipCreation orderCompilation(CompilationKey key, Match match, Player player, Long requestedBy,
                                          Actor actor) {
        Long viewerId = actor.userId();
        String faceitMatchId = match.getFaceitMatchId();
        String faceitPlayerId = SteamIds.maskPlayerId(player.getFaceitId());
        ClipQuality quality = key.quality();
        Optional<Long> existing = persistence.findLiveCompilation(key);
        if (existing.isPresent()) {
            return new ClipCreation(queries.summary(existing.get(), viewerId), false);
        }

        int tickRate = tickRateOfRecordableDemo(match, player);
        List<ClipSegment> segments = compilationSegments(facts.killTicksByRound(match.getId(), player.getId()),
                tickRate);
        if (segments.isEmpty()) {
            throw new ConflictException(NO_KILLS, "Player " + faceitPlayerId + " made no kill of an enemy in match "
                    + faceitMatchId + ", so there is nothing to compile");
        }
        rejectIfQueueFull();
        rejectIfTooLong(SegmentBuilder.totalTicks(segments), tickRate);

        long clipId;
        try {
            clipId = persistence.queueCompilation(key, properties.fps(), segments, requestedBy,
                    () -> usage.reserve(actor, UsageKind.CLIP_ORDER));
        } catch (DataIntegrityViolationException | QuotaExceededException e) {
            // A concurrent request queued the same compilation between the look above and the insert, and the unique
            // index let only one of them in. The loser's transaction is aborted, and the place it took for the order
            // with it; the clip it was after is the winner's. The same when the winner took the actor's last place.
            Optional<Long> winner = persistence.findLiveCompilation(key);
            if (winner.isEmpty()) {
                throw e;
            }
            log.info("Lost a concurrent request for the compilation of {} in match {} at {}, answering with clip {}",
                    faceitPlayerId, faceitMatchId, quality.label(), winner.get());
            return new ClipCreation(queries.summary(winner.get(), viewerId), false);
        }
        metrics.requested(ClipKind.COMPILATION);
        log.info("Queued clip {} at {} for the compilation of {} in match {}: {} segment(s), {} ticks", clipId,
                quality.label(), faceitPlayerId, faceitMatchId, segments.size(), SegmentBuilder.totalTicks(segments));
        return new ClipCreation(queries.summary(clipId, viewerId), true);
    }

    /**
     * Queues a montage: the stretches of a match the player picked in the editor, in his order, with the options he
     * chose. Unlike a compilation every order is a new clip, also one exactly like a montage that stands; nothing is
     * looked up first. The checks come in this order, and the first that fails ends the request:
     * <ol>
     *   <li>the options: a known quality ({@code null} is 720p) and shape ({@code null} is 16:9), a title of at most
     *       {@link EditorService#TITLE_MAX_LENGTH} characters with no control character, and a music track of
     *       {@code clip.music-tracks} or none
     *   <li>the segments as given: 1 to {@link EditorService#MAX_SEGMENTS} of them, each with both ticks, not negative,
     *       and its start before its end
     *   <li>the player is the actor's own (a user; the admin key and an administrator order for anyone)
     *   <li>the match, and then the player, are known to the database (FACEIT is not asked)
     *   <li>the file of the demo is stored, and the player's SteamID is known, as for a compilation
     *   <li>each segment lies within the rounds of the demo (from the first tick of the first round to the last of the
     *       last) and is not longer than {@link EditorService#MAX_SEGMENT_SECONDS}
     *   <li>the queue has room
     *   <li>the video, with each slow-motion segment twice its length and the intro card, is not longer than
     *       {@code clip.max-duration-seconds}
     *   <li>the actor has a clip order left today (a user; the admin key and an administrator are not limited)
     * </ol>
     *
     * @param actor who orders; the clip that is queued records its user
     * @throws BadRequestException {@code INVALID_MONTAGE_OPTION} or {@code INVALID_SEGMENTS}
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_YOUR_PLAYER}
     * @throws NotFoundException {@code MATCH_NOT_FOUND} or {@code PLAYER_NOT_FOUND}
     * @throws ConflictException {@code DEMO_NOT_AVAILABLE}, {@code PLAYER_STEAM_ID_UNKNOWN} or {@code CLIP_TOO_LONG}
     * @throws TooManyRequestsException {@code CLIP_QUEUE_FULL}
     * @throws QuotaExceededException {@code CLIP_LIMIT_REACHED}
     */
    public ClipCreation requestMontage(Actor actor, String faceitMatchId, MontageRequest request) {
        ClipQuality quality = montageQuality(request.quality());
        MontageOptions options = montageOptions(request);
        List<ClipSegment> segments = montageSegments(request.segments());

        String faceitPlayerId = request.playerId();
        access.requireOwnPlayer(actor, faceitPlayerId);
        Match match = matches.findByFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new NotFoundException(MATCH_NOT_FOUND, "Match not found: " + faceitMatchId));
        Player player = players.findByFaceitId(faceitPlayerId)
                .orElseThrow(() -> new NotFoundException(PLAYER_NOT_FOUND, "Player not found: " + faceitPlayerId));
        return orderMontage(match, player, quality, segments, options, actor.userId(), actor);
    }

    /**
     * A new montage in the queue: the checks of {@link #requestMontage} from the fifth on, for an order and for a retry
     * alike.
     *
     * @param requestedBy who the new clip is recorded for
     * @param actor who asks: the clip counts against their limit per day, and the answer is for them (see
     *        {@link ClipResponse#mine})
     */
    private ClipCreation orderMontage(Match match, Player player, ClipQuality quality, List<ClipSegment> segments,
                                      MontageOptions options, Long requestedBy, Actor actor) {
        String faceitMatchId = match.getFaceitMatchId();
        int tickRate = tickRateOfRecordableDemo(match, player);
        rejectIfOutsideDemo(segments, match, tickRate);
        rejectIfQueueFull();
        long videoTicks = SegmentBuilder.totalTicks(segments) + options.introTicks(tickRate);
        rejectIfTooLong(videoTicks, tickRate);

        long clipId = persistence.queueMontage(match.getId(), player.getId(), quality, properties.fps(), segments,
                options, requestedBy, () -> usage.reserve(actor, UsageKind.CLIP_ORDER));
        metrics.requested(ClipKind.MONTAGE);
        log.info("Queued clip {} at {} {} for a montage of {} in match {}: {} segment(s), {} ticks", clipId,
                quality.label(), options.aspect().label(), SteamIds.maskPlayerId(player.getFaceitId()), faceitMatchId,
                segments.size(), videoTicks);
        return new ClipCreation(queries.summary(clipId, actor.userId()), true);
    }

    private static ClipQuality montageQuality(String label) {
        if (label == null) {
            return ClipQuality.P720;
        }
        try {
            return ClipQuality.fromLabel(label);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException(INVALID_MONTAGE_OPTION, e.getMessage());
        }
    }

    /** The options of the request, or a 400 {@code INVALID_MONTAGE_OPTION} naming the first that is wrong. */
    private MontageOptions montageOptions(MontageRequest request) {
        ClipAspect aspect = request.aspect() == null ? ClipAspect.LANDSCAPE
                : ClipAspect.find(request.aspect()).orElseThrow(() -> new BadRequestException(INVALID_MONTAGE_OPTION,
                        "Unknown aspect; expected one of " + ClipAspect.labels()));
        String title = request.title() == null || request.title().isBlank() ? null : request.title().strip();
        if (title != null && title.codePointCount(0, title.length()) > EditorService.TITLE_MAX_LENGTH) {
            throw new BadRequestException(INVALID_MONTAGE_OPTION,
                    "The title is longer than " + EditorService.TITLE_MAX_LENGTH + " characters");
        }
        if (title != null && title.codePoints().anyMatch(Character::isISOControl)) {
            throw new BadRequestException(INVALID_MONTAGE_OPTION, "The title holds a control character");
        }
        String musicTrack = request.musicTrack() == null || request.musicTrack().isBlank() ? null
                : request.musicTrack();
        if (musicTrack != null && !properties.hasMusicTrack(musicTrack)) {
            throw new BadRequestException(INVALID_MONTAGE_OPTION, "Unknown music track; expected one of "
                    + properties.musicTracks().stream().map(ClipProperties.MusicTrack::id).toList());
        }
        return new MontageOptions(title, aspect, request.intro(), musicTrack);
    }

    /**
     * The segments of the request in its order, as long as their shape is right (the demo is not looked at here), or a
     * 400 {@code INVALID_SEGMENTS}.
     */
    private static List<ClipSegment> montageSegments(List<MontageRequest.Segment> requested) {
        if (requested == null || requested.isEmpty() || requested.size() > EditorService.MAX_SEGMENTS) {
            throw new BadRequestException(INVALID_SEGMENTS,
                    "A montage has 1 to " + EditorService.MAX_SEGMENTS + " segments");
        }
        List<ClipSegment> segments = new ArrayList<>(requested.size());
        for (int i = 0; i < requested.size(); i++) {
            MontageRequest.Segment segment = requested.get(i);
            if (segment == null || segment.startTick() == null || segment.endTick() == null) {
                throw new BadRequestException(INVALID_SEGMENTS, "Segment " + (i + 1) + " has no start or end tick");
            }
            if (segment.startTick() < 0 || segment.startTick() >= segment.endTick()) {
                throw new BadRequestException(INVALID_SEGMENTS,
                        "Segment " + (i + 1) + " must start at a tick of 0 or more and before its end");
            }
            segments.add(new ClipSegment(segment.startTick(), segment.endTick(), segment.slowMo()));
        }
        return segments;
    }

    /**
     * Refuses a segment that reaches outside the rounds of the demo or is longer than
     * {@link EditorService#MAX_SEGMENT_SECONDS}, with a 400 {@code INVALID_SEGMENTS}.
     */
    private void rejectIfOutsideDemo(List<ClipSegment> segments, Match match, int tickRate) {
        List<ClipFacts.RoundSpan> rounds = facts.rounds(match.getId());
        int firstTick = rounds.stream().mapToInt(ClipFacts.RoundSpan::startTick).min().orElse(Integer.MAX_VALUE);
        int lastTick = rounds.stream().mapToInt(ClipFacts.RoundSpan::endTick).max().orElse(Integer.MIN_VALUE);
        long maxTicks = (long) EditorService.MAX_SEGMENT_SECONDS * tickRate;
        for (int i = 0; i < segments.size(); i++) {
            ClipSegment segment = segments.get(i);
            if (segment.startTick() < firstTick || segment.endTick() > lastTick) {
                throw new BadRequestException(INVALID_SEGMENTS, "Segment " + (i + 1) + " lies outside the rounds of "
                        + "the demo of match " + match.getFaceitMatchId());
            }
            if (segment.ticks() > maxTicks) {
                throw new BadRequestException(INVALID_SEGMENTS, "Segment " + (i + 1) + " is longer than "
                        + EditorService.MAX_SEGMENT_SECONDS + " seconds");
            }
        }
    }

    /**
     * Orders a failed clip again: the same highlight (or the same compilation) at the same quality, as a new clip in
     * the queue, and the failed row goes with whatever its attempts left in the storage. The new clip is recorded for
     * whoever ordered the failed one, so a clip that an administrator retries for a user stays that user's. It counts
     * as one clip order of the actor who retries (a user; an administrator's retry is counted for nobody), and only
     * when it queues the new clip.
     *
     * <p>The clip is read under its lock, where {@link Access} is asked whether the actor may (a user retries only a
     * clip they ordered) and the status is looked at. Then it is ordered like any clip, with the same checks (the demo
     * file is still stored, the queue has room, ...): if one of them refuses, the failed clip stays as it was, to be
     * tried again later. The failed row goes only once its successor stands, and if it cannot be removed then (the
     * database fails at that moment) the retry has still succeeded: the answer is the new clip, a warning is logged and
     * the failed row stays until it is deleted or cleaned up. Two retries of the same clip at once leave one new clip:
     * the second finds the first one's and answers with it.
     *
     * <p>A clip of a highlight is ordered by the key the failed clip holds, not through the highlight row, so it can be
     * tried again after an analysis that no longer finds the highlight; the kills are read from the facts as always. A
     * montage is ordered again with the segments and the options it was ordered with, under the checks of
     * {@link #requestMontage} from the fifth on (its segments must still lie in the demo, which may have been parsed
     * again since). Nothing keeps a montage unique, so two retries of one at the same moment may each queue one.
     *
     * @return the new clip and {@code created} true; or, when a clip that is not failed already stood for the same
     *         highlight or compilation (someone ordered it again in the meantime), that clip and false
     * @throws NotFoundException {@code CLIP_NOT_FOUND}
     * @throws ForbiddenException {@code NOT_YOUR_CLIP}
     * @throws ConflictException {@code CLIP_NOT_FAILED}, and those of an order
     * @throws TooManyRequestsException {@code CLIP_QUEUE_FULL}
     * @throws QuotaExceededException {@code CLIP_LIMIT_REACHED}; the failed clip stays
     */
    public ClipCreation retry(Actor actor, long clipId) {
        FailedClip failed = persistence.findFailed(clipId,
                requestedBy -> access.requireClipOwner(actor, requestedBy));
        // The clip was just read with its match and player, so they are there; rows that have gone since took the clip
        // with them.
        Match match = matches.findById(failed.matchRowId()).orElseThrow(() -> clipNotFound(clipId));
        Player player = players.findById(failed.playerRowId()).orElseThrow(() -> clipNotFound(clipId));

        ClipCreation creation = switch (failed.kind()) {
            case HIGHLIGHT -> orderHighlightClip(new HighlightKey(failed.matchRowId(), failed.playerRowId(),
                    failed.highlightType(), failed.roundNumber(), failed.tickStart(), failed.quality()),
                    failed.tickEnd(), match, player, failed.requestedBy(), actor);
            case COMPILATION -> orderCompilation(new CompilationKey(failed.matchRowId(), failed.playerRowId(),
                    failed.quality()), match, player, failed.requestedBy(), actor);
            // Its own segments and options, as the player chose them; the rules of the demo are checked again.
            case MONTAGE -> orderMontage(match, player, failed.quality(), failed.segments(),
                    Objects.requireNonNullElse(failed.options(), NO_OPTIONS), failed.requestedBy(), actor);
        };
        try {
            remove(clipId, ANY_OWNER);
        } catch (NotFoundException e) {
            log.debug("Clip {} was removed by a concurrent retry or delete", clipId);
        } catch (RuntimeException e) {
            // The order stands, and that is what was asked for: the answer is the new clip. The failed row is left
            // behind for the clean-up of old clips, or for a delete.
            log.warn("Clip {} was tried again as clip {}, but the failed clip could not be removed and stays: {}",
                    clipId, creation.clip().id(), e.toString());
        }
        log.info("Clip {} was tried again as clip {}", clipId, creation.clip().id());
        return creation;
    }

    /**
     * The segments of a compilation: those of the player's kills in every round that has one, in the order of the
     * rounds. Each round is a window of its own, so a segment never runs from one round into the next. A round in
     * which he made no kill is left out, and so is one whose kills all lie outside the round: {@link SegmentBuilder}
     * shows a window with no kill in it whole, which is right for a highlight (a clutch won without a kill) and would
     * put a whole round that has nothing of the player into the video.
     */
    private List<ClipSegment> compilationSegments(List<RoundKills> rounds, int tickRate) {
        List<ClipSegment> segments = new ArrayList<>();
        for (RoundKills round : rounds) {
            boolean killInRound = round.ticks().stream()
                    .anyMatch(tick -> tick >= round.startTick() && tick <= round.endTick());
            if (killInRound) {
                segments.addAll(SegmentBuilder.build(round.ticks(), round.startTick(), round.endTick(), tickRate,
                        properties));
            }
        }
        return segments;
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

    /** @param ticks the length of the video, in ticks of the demo */
    private void rejectIfTooLong(long ticks, int tickRate) {
        if (ticks > (long) properties.maxDurationSeconds() * tickRate) {
            // Rounded up, so that the length named is above the limit named.
            long seconds = (long) Math.ceil((double) ticks / tickRate);
            throw new ConflictException(CLIP_TOO_LONG, "The clip would be " + seconds
                    + " seconds long; the longest allowed is " + properties.maxDurationSeconds() + " seconds");
        }
    }

    private void rejectIfQueueFull() {
        if (persistence.countQueued() >= properties.maxQueued()) {
            throw new TooManyRequestsException(CLIP_QUEUE_FULL,
                    "The clip queue is full (" + properties.maxQueued() + " clips are waiting), try again later");
        }
    }

    private static NotFoundException highlightNotFound(long highlightId) {
        return new NotFoundException(HIGHLIGHT_NOT_FOUND, "Highlight not found: " + highlightId);
    }

    private static NotFoundException clipNotFound(long clipId) {
        return new NotFoundException(CLIP_NOT_FOUND, "Clip not found: " + clipId);
    }

    /**
     * Deletes a clip and its files because someone asked: {@link Access} is asked, under the lock of the clip's row,
     * whether the actor may. A user deletes only a clip they ordered. Otherwise as {@link #delete(long)}.
     *
     * @throws NotFoundException {@code CLIP_NOT_FOUND}
     * @throws ForbiddenException {@code NOT_YOUR_CLIP}
     * @throws ConflictException {@code CLIP_IN_PROGRESS}
     */
    public void delete(Actor actor, long clipId) {
        remove(clipId, requestedBy -> access.requireClipOwner(actor, requestedBy));
    }

    /**
     * Deletes a clip and its files with no question of whose it is: for the clean-up of old clips, which nobody asked
     * for and which takes every clip alike. A request never comes this way. The row goes first,
     * under its lock, in one transaction; then the files are removed from the storage with no transaction open. A clip
     * that is waiting for a recorder can be deleted (that withdraws the request); one that a recorder is working on
     * cannot.
     *
     * <p>Every attempt to record a clip uploaded its files under keys of its own, and an attempt that was given up
     * left them there, so the files of every attempt are removed (see {@link #filesOf}), whatever the row names. A file
     * that cannot be removed stays in the storage as an orphan, which is a warning; the clip is gone all the same, and
     * so is the answer.
     *
     * @throws NotFoundException {@code CLIP_NOT_FOUND}
     * @throws ConflictException {@code CLIP_IN_PROGRESS}
     */
    public void delete(long clipId) {
        remove(clipId, ANY_OWNER);
    }

    private void remove(long clipId, Consumer<Long> requireOwner) {
        ClipPersistence.DeletedClip deleted = persistence.delete(clipId, requireOwner);
        for (String key : filesOf(clipId, deleted)) {
            removeFile(clipId, key);
        }
        log.info("Deleted clip {}", clipId);
    }

    /**
     * The keys of every file a clip may have in the storage: the video and the thumbnail of each of the attempts it
     * had, counted from 1 (a recorder uploads them under the names of {@link ClipFiles}), and the files its row named,
     * which are among those or, for a clip made before every attempt had names of its own, under another name.
     */
    private static Set<String> filesOf(long clipId, ClipPersistence.DeletedClip deleted) {
        Set<String> keys = new LinkedHashSet<>();
        for (int attempt = 1; attempt <= deleted.attempts(); attempt++) {
            keys.add(ClipFiles.video(clipId, attempt));
            keys.add(ClipFiles.thumbnail(clipId, attempt));
        }
        if (deleted.videoKey() != null) {
            keys.add(deleted.videoKey());
        }
        if (deleted.thumbnailKey() != null) {
            keys.add(deleted.thumbnailKey());
        }
        return keys;
    }

    private void removeFile(long clipId, String key) {
        try {
            storage.delete(key);
        } catch (StorageException e) {
            log.warn("Deleted clip {}, but {} could not be removed and stays in the storage: {}", clipId, key,
                    e.toString());
        }
    }
}
