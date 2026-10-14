package io.csfaceit.backend.cs2;

import io.csfaceit.backend.auth.Actor;
import io.csfaceit.backend.cs2.BridgeClient.Resolution;
import io.csfaceit.backend.cs2.Cs2Links.Claimed;
import io.csfaceit.backend.cs2.Cs2Links.Progress;
import io.csfaceit.backend.cs2.Cs2Links.State;
import io.csfaceit.backend.cs2.SteamShareCodeClient.Answer;
import io.csfaceit.backend.demo.Demo;
import io.csfaceit.backend.demo.DemoErrorCode;
import io.csfaceit.backend.demo.DemoLinkRefusedException;
import io.csfaceit.backend.demo.DemoPersistence;
import io.csfaceit.backend.demo.DemoRepository;
import io.csfaceit.backend.demo.DemoService;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.match.MatchSource;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Walks the chains of CS2 match sharing codes of the linked players and brings the matches it finds, every
 * {@code cs2.sync.interval} counted from the end of the last run (so runs never overlap in one process). Nothing is done
 * while the feature is off ({@link Cs2Properties#enabled}).
 *
 * <p>A run claims at most {@code links-per-run} {@code ACTIVE} links that are due, the longest waiting first
 * ({@link Cs2Links#claimDue}: one short statement that also pushes their next look ahead, so two backends never walk the
 * same link). Then, for each link, with no transaction open, at most {@code steps-per-link} steps of two parts:
 * <ol>
 *   <li>The code that is pending, if any (the one the player gave, or the last one Steam gave), goes to the bridge
 *       ({@link BridgeClient}). Its match is made, owned by the player, and its replay is imported through the path of a
 *       pasted link ({@link DemoService#requestImport(String, URI, Actor)}) as the site itself ({@link Actor#system()}:
 *       no limit counts it). A match that has a demo is left alone, except a demo of the player's own match that failed
 *       at the import stage and was never analyzed, which is queued again: so a failed import is tried again when the
 *       walk meets its code again (after a back-off, or when the player links again with that code). A replay that is
 *       not ready yet is
 *       asked for again after {@code not-ready-recheck}, and the link stops for this run. An expired one leaves the
 *       match with a FAILED demo ({@code REPLAY_EXPIRED}) and is never asked for again. A match the game coordinator
 *       does not know is let go. A bridge that fails, is busy or does not answer stops the link with a back-off.
 *   <li>Steam is asked for the code after the last known one ({@link SteamShareCodeClient}). A newer code becomes the
 *       known one and the pending one, and the next step brings its match. No newer code: the link is looked at again
 *       after {@code idle-recheck}. A refused authentication code or known code puts the link into
 *       {@code BAD_AUTH_CODE} or {@code BAD_SHARE_CODE}, where it stays until the player links again (a 403 counts
 *       for the authentication code only once Steam has said that the site's key is good). Steam's 429, and a refused key
 *       of the site, end the whole run and change no link. A Steam that fails or does not answer stops the link with a
 *       back-off.
 * </ol>
 * The back-off is {@code 2^failures} minutes after the failure, at most an hour; any answer that is not a failure resets
 * the count. Each step's result is written at once ({@link Cs2Links#update}), only while the link is still the one the
 * run claimed: a player who links again or unlinks meanwhile stops the walk of the old link.
 *
 * <p>The authentication code is opened only for the Steam call; a code that does not open (the secret was changed) puts
 * the link into {@code BAD_AUTH_CODE}, and the run goes on. No code is ever logged: a link is named by its user's id.
 */
@Component
public class Cs2ChainJob {

    /** What a lease adds to the longest a run can take, for the pacing of the link requests that run meanwhile. */
    private static final Duration LEASE_MARGIN = Duration.ofMinutes(5);

    /** The pause between two Steam calls ({@link SteamShareCodeClient}). */
    private static final Duration STEAM_PACE = Duration.ofSeconds(1);

    /** The longest back-off. */
    private static final Duration MAX_BACKOFF = Duration.ofHours(1);

    static final String REPLAY_EXPIRED_ERROR = "Valve no longer keeps the replay of this match, so its demo cannot be "
            + "downloaded; upload the file if you kept it";

    private static final Logger log = LoggerFactory.getLogger(Cs2ChainJob.class);

    private final Cs2Properties properties;
    private final Cs2Links links;
    private final AuthCodeCipher cipher;
    private final SteamShareCodeClient steam;
    private final BridgeClient bridge;
    private final DemoService demoService;
    private final DemoRepository demos;
    private final DemoPersistence demoPersistence;
    private final MatchRepository matches;
    private final Clock clock;

    /**
     * How long a claimed link is kept from the others: the longest one run can take with these settings (every link it
     * claimed walked to its last step, each step waiting out the bridge's and Steam's timeouts and the pacing), and a
     * margin. A link that is walked has its lease renewed at every step.
     */
    private final Duration lease;

    public Cs2ChainJob(Cs2Properties properties, Cs2Links links, AuthCodeCipher cipher, SteamShareCodeClient steam,
                       BridgeClient bridge, DemoService demoService, DemoRepository demos,
                       DemoPersistence demoPersistence, MatchRepository matches, Clock clock) {
        this.properties = properties;
        this.links = links;
        this.cipher = cipher;
        this.steam = steam;
        this.bridge = bridge;
        this.demoService = demoService;
        this.demos = demos;
        this.demoPersistence = demoPersistence;
        this.matches = matches;
        this.clock = clock;
        Duration step = properties.bridgeTimeout().plus(properties.steamTimeout()).plus(STEAM_PACE);
        this.lease = step.multipliedBy((long) properties.sync().linksPerRun() * properties.sync().stepsPerLink())
                .plus(LEASE_MARGIN);
    }

    @Scheduled(fixedDelayString = "${cs2.sync.interval:2m}", initialDelayString = "${cs2.sync.interval:2m}")
    public void run() {
        try {
            runOnce();
        } catch (RuntimeException e) {
            // The class only: nothing that reaches here may quote a code, but nothing has to be trusted to.
            log.warn("CS2 walk: the run failed, trying again at the next one: {}", e.getClass().getSimpleName());
        }
    }

    /** One run: the due links, each walked as far as its steps allow. */
    public void runOnce() {
        if (!properties.enabled()) {
            return;
        }
        Instant now = now();
        List<Claimed> due = links.claimDue(now, properties.sync().linksPerRun(), now.plus(lease));
        if (due.isEmpty()) {
            return;
        }
        Run run = new Run();
        for (Claimed link : due) {
            if (run.stopped()) {
                // Steam said the site asks too often, or refused its key: the links not walked yet are due again at the
                // next run.
                links.update(link, new Progress(State.ACTIVE, link.lastShareCode(), link.pendingShareCode(),
                        link.failures(), now(), null));
                continue;
            }
            try {
                walk(link, run);
            } catch (RuntimeException e) {
                // A bug or the database away: the link keeps its lease and is walked again when that ends.
                log.warn("CS2 walk: the link of user {} could not be walked: {}", link.userId(),
                        e.getClass().getSimpleName());
            }
        }
        log.info("CS2 walk: looked at {} link(s), brought {} match(es){}", due.size(), run.brought,
                run.rateLimited ? "; Steam asked to slow down, the run ended early"
                        : run.keyRefused ? "; Steam refused the site's key, the run ended early" : "");
    }

    /** What one run has seen so far. */
    private static final class Run {
        int brought;
        boolean rateLimited;
        boolean keyRefused;
        boolean bridgeTokenReported;
        /** Whether Steam has said in this run that the site's key is good (asked at most once a run). */
        final SteamShareCodeClient.KeyCheck keyCheck = new SteamShareCodeClient.KeyCheck();

        boolean stopped() {
            return rateLimited || keyRefused;
        }
    }

    /** Where one link's walk stands; written after every step. */
    private final class Walk {
        final Claimed link;
        State state = State.ACTIVE;
        String last;
        String pending;
        int failures;
        Instant nextCheckAt;
        Instant checkedAt;
        String authCode;

        Walk(Claimed link) {
            this.link = link;
            this.last = link.lastShareCode();
            this.pending = link.pendingShareCode();
            this.failures = link.failures();
        }

        /** Writes the walk; false when the link was made again or deleted meanwhile, and the walk has to stop. */
        boolean save(Instant nextCheck) {
            nextCheckAt = nextCheck;
            return links.update(link, new Progress(state, last, pending, failures, nextCheckAt, checkedAt));
        }

        /** A failure that may go away: the next look waits {@code 2^failures} minutes, at most an hour. */
        void backOff() {
            failures++;
            save(now().plus(failures >= 6 ? MAX_BACKOFF : Duration.ofMinutes(1L << failures)));
        }
    }

    private void walk(Claimed link, Run run) {
        // The checked time is written only when Steam answers in this walk; until then the stored one stays.
        Walk walk = new Walk(link);
        for (int step = 0; step < properties.sync().stepsPerLink(); step++) {
            if (walk.pending != null && !resolvePending(walk, run)) {
                return;
            }
            if (!askSteam(walk, run)) {
                return;
            }
        }
        // Out of steps with more to do (a pending code, or a chain that may go on): due again at the next run.
        walk.save(now());
    }

    /**
     * Brings the match of the pending code.
     *
     * @return whether the walk goes on to Steam
     */
    private boolean resolvePending(Walk walk, Run run) {
        String code = walk.pending;
        long userId = walk.link.userId();
        Resolution resolution = bridge.resolve(code);
        switch (resolution.outcome()) {
            case RESOLVED -> {
                Optional<String> matchId = MatchSource.matchmakingId(resolution.matchId());
                if (matchId.isEmpty()) {
                    log.warn("CS2 walk: the bridge gave the code of user {} a match id that is no Valve match id; "
                            + "it is let go", userId);
                } else {
                    try {
                        if (bring(matchId.get(), userId, code, resolution)) {
                            run.brought++;
                        }
                    } catch (RuntimeException e) {
                        // The database or the broker away, or the replay's host did not resolve: the code stays pending
                        // and is tried again after the back-off. A demo that the failed attempt left FAILED (its message
                        // could not be published) is queued again then (see bring).
                        log.warn("CS2 walk: could not bring match {} of user {}: {}", matchId.get(), userId,
                                e.getClass().getSimpleName());
                        walk.backOff();
                        return false;
                    }
                }
                walk.pending = null;
                walk.failures = 0;
                return walk.save(leaseEnd());
            }
            case NOT_READY -> {
                walk.failures = 0;
                walk.save(now().plus(properties.sync().notReadyRecheck()));
                return false;
            }
            case EXPIRED -> {
                Optional<String> matchId = ShareCode.matchId(code).flatMap(MatchSource::matchmakingId);
                if (matchId.isEmpty()) {
                    log.warn("CS2 walk: an expired replay of user {} has a code that names no match; it is let go",
                            userId);
                } else if (links.saveExpiredMatch(matchId.get(), userId, code, resolution.matchTime(),
                        REPLAY_EXPIRED_ERROR, now())) {
                    log.info("CS2 walk: match {} of user {} has no replay any more; its demo is FAILED as "
                            + "REPLAY_EXPIRED", matchId.get(), userId);
                }
                walk.pending = null;
                walk.failures = 0;
                return walk.save(leaseEnd());
            }
            case UNKNOWN -> {
                log.warn("CS2 walk: the game coordinator does not know a match of user {}; it is let go", userId);
                walk.pending = null;
                walk.failures = 0;
                return walk.save(leaseEnd());
            }
            case UNAUTHORIZED -> {
                if (!run.bridgeTokenReported) {
                    run.bridgeTokenReported = true;
                    log.error("CS2 walk: the bridge to the game coordinator refused the site's token: CS2_BRIDGE_TOKEN "
                            + "is not the BRIDGE_TOKEN the bridge was started with");
                }
                walk.backOff();
                return false;
            }
            default -> {
                log.warn("CS2 walk: the bridge could not answer for a match of user {}; trying again later", userId);
                walk.backOff();
                return false;
            }
        }
    }

    /**
     * Makes the match and queues the import of its replay, unless the match has a demo already.
     *
     * @return whether an import was queued
     */
    private boolean bring(String matchId, long userId, String code, Resolution resolution) {
        links.saveMatch(matchId, userId, code, resolution.matchTime());
        Optional<Demo> existing = demos.findByMatchFaceitMatchId(matchId);
        boolean revive = existing.isPresent() && isFailedImportOfOwnMatch(existing.get(), matchId, userId);
        if (existing.isPresent() && !revive) {
            return false;
        }
        URI replay;
        try {
            replay = URI.create(resolution.replayUrl());
        } catch (IllegalArgumentException e) {
            log.warn("CS2 walk: the bridge gave match {} of user {} a replay address that is not one", matchId, userId);
            return false;
        }
        try {
            demoService.requestImport(matchId, replay, Actor.system(), revive);
        } catch (DemoLinkRefusedException e) {
            if (e.isUnresolvedHost()) {
                // May pass: thrown on, so that the code stays pending and is tried again after the back-off.
                throw e;
            }
            // Refused for good (its host, its addresses or its name): the match stays, without a demo, for an upload.
            log.warn("CS2 walk: the replay of match {} of user {} was refused: {}", matchId, userId, e.getCode());
            return false;
        }
        log.info("CS2 walk: queued the {}import of match {} of user {}", revive ? "repeated " : "", matchId, userId);
        return true;
    }

    /**
     * Whether a demo that the match already has is one the walk may queue again: FAILED at the import stage (never
     * stored: {@code IMPORT_FAILED}, or no code, which is a link that was gone, a download refused or a message that could
     * not be published), of a match that belongs to the link's player and was never analyzed. Never a demo that was
     * stored and then failed (a parse failure, {@code WRONG_MATCH}) or whose replay expired ({@code REPLAY_EXPIRED}).
     */
    private boolean isFailedImportOfOwnMatch(Demo demo, String matchId, long userId) {
        if (demo.getStatus() != DemoStatus.FAILED || demo.getStorageKey() != null
                || (demo.getErrorCode() != null && demo.getErrorCode() != DemoErrorCode.IMPORT_FAILED)) {
            return false;
        }
        Optional<Match> match = matches.findByFaceitMatchId(matchId);
        return match.isPresent() && Long.valueOf(userId).equals(match.get().getOwnerUserId())
                && demoPersistence.isOpenToFirstDemo(match.get().getId());
    }

    /**
     * Asks Steam for the code after the last known one.
     *
     * @return whether the walk goes on with another step
     */
    private boolean askSteam(Walk walk, Run run) {
        long userId = walk.link.userId();
        if (walk.link.steamId() == null || walk.link.steamId().isBlank()) {
            log.warn("CS2 walk: user {} has no SteamID; the link waits", userId);
            walk.save(now().plus(properties.sync().idleRecheck()));
            return false;
        }
        if (walk.authCode == null) {
            try {
                walk.authCode = cipher.open(userId, walk.link.authCode());
            } catch (AuthCodeCipher.Unreadable e) {
                log.warn("CS2 walk: the authentication code of user {} cannot be opened (CS2_LINK_SECRET changed?); "
                        + "the link is now {}", userId, State.BAD_AUTH_CODE);
                walk.state = State.BAD_AUTH_CODE;
                walk.save(null);
                return false;
            }
        }
        Answer answer = steam.nextCode(walk.link.steamId(), walk.authCode, walk.last, run.keyCheck);
        if (answer.answered() && answer.outcome() != SteamShareCodeClient.Outcome.RATE_LIMITED
                && answer.outcome() != SteamShareCodeClient.Outcome.KEY_REFUSED) {
            walk.checkedAt = now();
        }
        switch (answer.outcome()) {
            case NEXT -> {
                walk.last = answer.nextCode();
                walk.pending = answer.nextCode();
                walk.failures = 0;
                return walk.save(leaseEnd());
            }
            case NONE -> {
                walk.failures = 0;
                walk.save(now().plus(properties.sync().idleRecheck()));
                return false;
            }
            case AUTH_CODE_REFUSED, SHARE_CODE_REFUSED -> {
                walk.state = answer.outcome() == SteamShareCodeClient.Outcome.AUTH_CODE_REFUSED
                        ? State.BAD_AUTH_CODE : State.BAD_SHARE_CODE;
                walk.failures = 0;
                log.info("CS2 walk: Steam refused the link of user {}; it is now {}", userId, walk.state);
                walk.save(null);
                return false;
            }
            case RATE_LIMITED -> {
                // Nothing else changes: the link is due again at the next run, and the run ends.
                run.rateLimited = true;
                log.warn("CS2 walk: Steam answered 429; the run ends here");
                walk.save(now());
                return false;
            }
            case KEY_REFUSED -> {
                // The site's key, not the player's code: no link changes, and the run ends as for a 429.
                run.keyRefused = true;
                log.error("CS2 walk: Steam refused the site's key; check STEAM_WEB_API_KEY. The run ends here, and no "
                        + "link is changed");
                walk.save(now());
                return false;
            }
            default -> {
                walk.backOff();
                return false;
            }
        }
    }

    /** The lease of a claimed link, written while its walk goes on: the walk writes the real next look when it stops. */
    private Instant leaseEnd() {
        return now().plus(lease);
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
