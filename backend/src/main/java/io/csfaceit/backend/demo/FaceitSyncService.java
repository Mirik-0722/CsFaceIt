package io.csfaceit.backend.demo;

import io.csfaceit.backend.auth.Actor;
import io.csfaceit.backend.auth.UserRepository;
import io.csfaceit.backend.auth.UserRepository.SyncCandidate;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.FaceitRejectedException;
import io.csfaceit.backend.faceit.dto.FaceitHistoryItem;
import io.csfaceit.backend.faceit.dto.FaceitMatchHistory;
import io.csfaceit.backend.match.MatchSource;
import io.csfaceit.backend.messaging.DemoImportWorker;
import io.csfaceit.backend.messaging.DemoMetrics;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

/**
 * Brings the demos of a signed-in player's new FACEIT matches by themselves, so that the player does not have to ask
 * for each one. It is the work behind two entry points: {@code POST /api/v1/matches/sync}, which the page of a player's
 * matches calls when it opens ({@link #syncNow}), and the job that goes on while the player is away
 * ({@link FaceitSyncJob}, {@link #runOnce}). Both do nothing while {@link #enabled()} is false, that is, while the
 * site has no token for FACEIT's Downloads API (a demo could not be downloaded) or the setting says so.
 *
 * <p>The sync of one player reads their recent history through the cached FACEIT gateway and takes the finished matches
 * that started within {@code faceit.sync.max-age}, newest first. A match that has a {@code demos} row, in any state, is
 * left alone: a FAILED import is not revived here (only a person asking by hand does that), and the sync never asks
 * for the same thing twice. For the others, at most {@code matches-per-user} imports are queued through
 * {@link DemoService#requestImport}, which is the path a member's own import takes, as {@link Actor#system()}, whose
 * imports no player's limit counts. A match that FACEIT has no demo for yet gets no row and is looked at again next
 * time. Then {@code users.faceit_synced_at} is set, after every attempt whatever its outcome: a FACEIT outage is tried
 * again after {@code min-user-interval}, and a player FACEIT keeps refusing goes to the back of the line instead of
 * holding the front of it. A request of the system never takes up a demo that has a row, FAILED or not, also when the
 * row appears or fails after the history was read ({@link DemoPersistence#queue}).
 *
 * <p>Two backends, an overlapping run and a request that comes with a run cannot queue a match twice, because queueing
 * is {@link DemoPersistence#queue}: it takes the lock of the match's {@code demos} row, and a match that has none is
 * inserted under the unique key on {@code demos.match_id}, so the loser of two inserts finds the winner's row and
 * publishes nothing. What can happen twice is the history and match reads (cached), and a request that loses such a race
 * may count a match as queued that the other one queued. Within one process a player is also synced by one thread at a
 * time.
 *
 * <p>The same run republishes the import messages that look lost: a demo that has stayed QUEUED for longer than
 * {@link DemoPersistence#STALE_AFTER}. A running import touches its demo every minute (the worker's heartbeat), so a
 * live one never looks lost, and the sweep takes a demo ({@link DemoPersistence#claimStaleQueued}, which touches it
 * under the row's lock) before it publishes, so a demo is republished at most once per that time and by one backend.
 * A demo whose pasted link this backend holds is republished without asking FACEIT. For the others FACEIT is asked
 * for the demo address, at most {@code matches-per-run} times per run. A demo with neither a held link nor a FACEIT
 * demo address is left for 30 minutes (twice the link's lifetime, so that a link held by another backend is not given
 * up on; until then FACEIT is not asked about it again) and is then FAILED with the "link no longer known" reason. A
 * demo whose match FACEIT does not know, or refuses as a request, is FAILED at once; a refusal of the site's own key
 * ({@link FaceitRejectedException#isCredentialRefusal}) or a failure that may go away (FACEIT or the broker
 * unavailable) leaves the demo touched, which sends it to the back of the line.
 */
@Service
public class FaceitSyncService {

    /** How much of a player's history is read; the matches wanted are the newest, the page is a little more. */
    private static final int HISTORY_PAGE = 20;

    /** How many demos that look lost one run looks at; at most {@code matches-per-run} of them are republished. */
    private static final int LOST_PAGE = 50;

    /** A demo queued for a pasted link that nobody holds is given up when untouched for twice the link's lifetime. */
    private static final Duration GIVE_UP_AFTER = PastedLinks.TTL.multipliedBy(2);

    private static final Logger log = LoggerFactory.getLogger(FaceitSyncService.class);

    /** What {@code POST /api/v1/matches/sync} answers: whether the sync is on at all, and how many imports it queued. */
    public record SyncResult(boolean enabled, int queued) {
    }

    private final FaceitSyncProperties settings;
    private final FaceitDownloadsApi downloads;
    private final FaceitGateway faceit;
    private final DemoRepository demos;
    private final DemoService demoService;
    private final DemoPersistence persistence;
    private final DemoMetrics metrics;
    private final PastedLinks pastedLinks;
    private final UserRepository users;
    private final Clock clock;

    /** The players being synced by this process right now. */
    private final Set<Long> syncing = ConcurrentHashMap.newKeySet();

    /**
     * The demos the sweep found with neither a held link nor a FACEIT address, and when to look at them again (when
     * they may be given up): until then FACEIT is not asked about them at every run. Lost on a restart, which only
     * means one more look.
     */
    private final Map<Long, Instant> waitingForLink = new ConcurrentHashMap<>();

    public FaceitSyncService(FaceitSyncProperties settings, FaceitDownloadsApi downloads, FaceitGateway faceit,
                             DemoRepository demos, DemoService demoService, DemoPersistence persistence,
                             DemoMetrics metrics, PastedLinks pastedLinks, UserRepository users, Clock clock) {
        this.settings = settings;
        this.downloads = downloads;
        this.faceit = faceit;
        this.demos = demos;
        this.demoService = demoService;
        this.persistence = persistence;
        this.metrics = metrics;
        this.pastedLinks = pastedLinks;
        this.users = users;
        this.clock = clock;
        if (!settings.enabled()) {
            log.info("The automatic sync of FACEIT demos is off (faceit.sync.enabled=false)");
        } else if (!downloads.isConfigured()) {
            log.info("The automatic sync of FACEIT demos is off: the site has no token for FACEIT's Downloads API "
                    + "(FACEIT_DOWNLOADS_TOKEN), so a demo could not be downloaded");
        }
    }

    /** Whether anything is done at all: the setting is on and the site can download a demo from FACEIT. */
    public boolean enabled() {
        return settings.enabled() && downloads.isConfigured();
    }

    /**
     * Syncs the player of a signed-in user now, unless that was done within {@code min-user-interval}. Never asks for
     * more than {@code matches-per-user} imports.
     */
    public SyncResult syncNow(long userId, String playerId) {
        if (!enabled()) {
            return new SyncResult(false, 0);
        }
        Instant now = clock.instant();
        if (users.countDueForSync(userId, now.minus(settings.minUserInterval())) == 0) {
            return new SyncResult(true, 0);
        }
        return new SyncResult(true, syncUser(userId, playerId, settings.matchesPerUser()));
    }

    /** One run of the job: the lost import messages first, then the players who are due, oldest sync first. */
    public void runOnce() {
        if (!enabled()) {
            return;
        }
        try {
            republishLostImports();
        } catch (RuntimeException e) {
            log.warn("FACEIT sync: could not look for lost import messages: {}", e.toString());
        }
        Instant now = clock.instant();
        List<SyncCandidate> due = users.findDueForSync(now.minus(settings.seenWithin()),
                now.minus(settings.minUserInterval()), settings.usersPerRun());
        int budget = settings.matchesPerRun();
        int queued = 0;
        for (SyncCandidate candidate : due) {
            if (budget <= 0) {
                break;
            }
            int done = syncUser(candidate.getId(), candidate.getFaceitId(), Math.min(budget, settings.matchesPerUser()));
            budget -= done;
            queued += done;
        }
        if (queued > 0 || !due.isEmpty()) {
            log.info("FACEIT sync: looked at {} player(s), queued {} import(s)", due.size(), queued);
        }
    }

    /**
     * Queues the imports of the player's matches that have no demo yet, at most {@code limit}.
     *
     * @return how many imports were queued
     */
    private int syncUser(long userId, String playerId, int limit) {
        if (!syncing.add(userId)) {
            return 0;
        }
        try {
            try {
                return queueMissing(playerId, limit);
            } finally {
                // Every attempt counts, whatever came of it: see the class comment. A failure to note it (the database
                // is away) is logged and must neither hide the exception that is on its way nor skip the removal below.
                try {
                    users.markSynced(userId, clock.instant());
                } catch (RuntimeException e) {
                    log.warn("FACEIT sync: could not note that a player was synced: {}", e.getClass().getSimpleName());
                }
            }
        } finally {
            syncing.remove(userId);
        }
    }

    private int queueMissing(String playerId, int limit) {
        FaceitMatchHistory history;
        try {
            history = faceit.getHistory(playerId, 0, HISTORY_PAGE);
        } catch (RuntimeException e) {
            log.warn("FACEIT sync: could not read the history of a player: {}", e.getClass().getSimpleName());
            return 0;
        }
        long startedAfter = clock.instant().minus(settings.maxAge()).getEpochSecond();
        List<FaceitHistoryItem> items = history.items() == null ? List.of() : history.items().stream()
                .filter(item -> item != null && item.matchId() != null && item.finishedAt() > 0
                        && item.startedAt() >= startedAfter)
                .sorted(Comparator.comparingLong(FaceitHistoryItem::startedAt).reversed())
                .toList();

        int queued = 0;
        for (FaceitHistoryItem item : items) {
            if (queued >= limit) {
                break;
            }
            if (demos.existsByMatchFaceitMatchId(item.matchId())) {
                continue;
            }
            try {
                demoService.requestImport(Actor.system(), item.matchId());
                queued++;
            } catch (ConflictException e) {
                // FACEIT has no demo for the match (yet): no row was written, so a later sync looks again.
                log.debug("FACEIT sync: match {} has no demo yet", item.matchId());
            } catch (NotFoundException e) {
                log.debug("FACEIT sync: FACEIT does not know match {}", item.matchId());
            } catch (RuntimeException e) {
                log.warn("FACEIT sync: could not queue match {}: {}", item.matchId(), e.getClass().getSimpleName());
                return queued;
            }
        }
        return queued;
    }

    /**
     * Looks at the demos that have stayed QUEUED for longer than {@link DemoPersistence#STALE_AFTER} (see the class
     * comment for the rules). The page looked at is larger than what one run may republish, so that demos waiting for
     * their 30 minutes do not hide the others.
     */
    private void republishLostImports() {
        Instant now = clock.instant();
        Instant staleBefore = now.minus(DemoPersistence.STALE_AFTER);
        Instant giveUpBefore = now.minus(GIVE_UP_AFTER);
        List<Demo> lost = demos.findUntouchedSince(DemoStatus.QUEUED, staleBefore, PageRequest.of(0, LOST_PAGE));
        // Forget the demos that are no longer among the lost ones (imported, failed, gone).
        waitingForLink.keySet().retainAll(lost.stream().map(Demo::getId).collect(Collectors.toSet()));
        // The most FACEIT is asked about in one run, and the most messages one run publishes.
        int reads = settings.matchesPerRun();
        int budget = settings.matchesPerRun();
        for (Demo demo : lost) {
            if (budget <= 0) {
                break;
            }
            long demoId = demo.getId();
            String matchId = demo.getMatch().getFaceitMatchId();
            // A link held here needs no FACEIT: the worker downloads the link, so the demo is republished without asking
            // FACEIT, also while FACEIT is down or refuses the site's key.
            String demoUrl = null;
            if (pastedLinks.peek(demoId).isEmpty()) {
                // A demo that FACEIT had no address for waits out its time without asking FACEIT again at every run.
                Instant lookAgainAt = waitingForLink.get(demoId);
                // A matchmaking match has no FACEIT address and FACEIT is never asked about it: only a pasted link
                // queues its demo, so it goes to the case of a link that is gone below, and spends no read.
                boolean matchmaking = MatchSource.isMatchmaking(matchId);
                if ((!matchmaking && reads <= 0) || (lookAgainAt != null && now.isBefore(lookAgainAt))) {
                    continue;
                }
                if (!matchmaking) {
                    reads--;
                }
                try {
                    demoUrl = matchmaking ? null : demoService.faceitDemoUrl(matchId);
                } catch (NotFoundException e) {
                    failForMatchFaceitDoesNotGive(demoId, matchId, staleBefore);
                    continue;
                } catch (FaceitRejectedException e) {
                    if (!e.isCredentialRefusal()) {
                        failForMatchFaceitDoesNotGive(demoId, matchId, staleBefore);
                        continue;
                    }
                    // The site's own key or token is wrong or revoked, which says nothing about the demo. It is never
                    // failed for that; it is taken (touched) like for any failure that may go away.
                    persistence.claimStaleQueued(demoId, staleBefore);
                    log.warn("FACEIT sync: FACEIT refused the site's credentials (HTTP {}) asking about match {} for "
                            + "its lost demo {}", e.getStatus(), matchId, demoId);
                    continue;
                } catch (RuntimeException e) {
                    // May go away: the demo is taken (touched) so that it goes to the back of the line.
                    persistence.claimStaleQueued(demoId, staleBefore);
                    log.warn("FACEIT sync: could not ask FACEIT about match {} for its lost demo {}: {}", matchId,
                            demoId, e.getClass().getSimpleName());
                    continue;
                }
                if (demoUrl == null || demoUrl.isBlank()) {
                    // Queued for a pasted link that this backend does not hold. Another backend may hold it, so the
                    // demo is given up only when the link must have expired everywhere.
                    if (persistence.failStaleQueued(demoId, giveUpBefore, DemoImportWorker.PASTED_LINK_GONE, null)) {
                        waitingForLink.remove(demoId);
                        metrics.failed(DemoMetrics.STAGE_IMPORT);
                        log.warn("FACEIT sync: demo {} of match {} was queued for a pasted link that is gone; FAILED",
                                demoId, matchId);
                    } else {
                        waitingForLink.put(demoId, demo.getUpdatedAt().plus(GIVE_UP_AFTER));
                    }
                    continue;
                }
            }
            waitingForLink.remove(demoId);
            if (!persistence.claimStaleQueued(demoId, staleBefore)) {
                continue;
            }
            try {
                demoService.republishImport(demoId, matchId, demoUrl);
                budget--;
                log.warn("FACEIT sync: demo {} of match {} has been QUEUED for a long time; published its import again",
                        demoId, matchId);
            } catch (RuntimeException e) {
                log.warn("FACEIT sync: could not publish the import of demo {} of match {} again: {}", demoId, matchId,
                        e.getClass().getSimpleName());
            }
        }
    }

    /** FACEIT does not know the match, or refuses the request itself: asking again changes nothing. */
    private void failForMatchFaceitDoesNotGive(long demoId, String matchId, Instant staleBefore) {
        if (persistence.failStaleQueued(demoId, staleBefore,
                "FACEIT does not give this match any more, so its demo cannot be imported",
                DemoErrorCode.IMPORT_FAILED)) {
            metrics.failed(DemoMetrics.STAGE_IMPORT);
            log.warn("FACEIT sync: demo {} of match {} was queued for a match FACEIT does not give; FAILED", demoId,
                    matchId);
        }
    }
}
