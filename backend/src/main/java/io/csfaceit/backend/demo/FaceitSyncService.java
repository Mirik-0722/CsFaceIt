package io.csfaceit.backend.demo;

import io.csfaceit.backend.auth.Actor;
import io.csfaceit.backend.auth.UserRepository;
import io.csfaceit.backend.auth.UserRepository.SyncCandidate;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.dto.FaceitHistoryItem;
import io.csfaceit.backend.faceit.dto.FaceitMatchHistory;
import io.csfaceit.backend.messaging.DemoImportWorker;
import io.csfaceit.backend.messaging.DemoMetrics;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
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
 * time. Then {@code users.faceit_synced_at} is set; a FACEIT failure leaves it as it was, so the next run tries again.
 *
 * <p>Two backends, an overlapping run and a request that comes with a run cannot queue a match twice, because queueing
 * is {@link DemoPersistence#queue}: it takes the lock of the match's {@code demos} row, and a match that has none is
 * inserted under the unique key on {@code demos.match_id}, so the loser of two inserts finds the winner's row and
 * publishes nothing. What can happen twice is the history and match reads (cached), and a request that loses such a race
 * may count a match as queued that the other one queued. Within one process a player is also synced by one thread at a
 * time.
 *
 * <p>The same run republishes the import messages that look lost: a demo that has stayed QUEUED for longer than
 * {@link DemoPersistence#STALE_AFTER} (its row has not been touched, and an import touches it when it starts).
 */
@Service
public class FaceitSyncService {

    /** How much of a player's history is read; the matches wanted are the newest, the page is a little more. */
    private static final int HISTORY_PAGE = 20;

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
            FaceitMatchHistory history;
            try {
                history = faceit.getHistory(playerId, 0, HISTORY_PAGE);
            } catch (RuntimeException e) {
                log.warn("FACEIT sync: could not read the history of user {}: {}", userId, e.toString());
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
                    log.warn("FACEIT sync: could not queue match {} of user {}: {}", item.matchId(), userId,
                            e.toString());
                    return queued;
                }
            }
            users.markSynced(userId, clock.instant());
            return queued;
        } finally {
            syncing.remove(userId);
        }
    }

    /**
     * Publishes again the import message of each demo that has stayed QUEUED for longer than
     * {@link DemoPersistence#STALE_AFTER}, at most {@code matches-per-run} of them. It is {@link DemoService#requestImport}
     * that does it, which under the row's lock touches a demo that is that stale and tells at most one caller to
     * publish. A demo whose pasted link is still held is sent with it; one whose link is gone goes the way an import
     * without a link goes: FACEIT's own address when the match has one, and when it has none (the demo was queued for
     * the link alone) it is FAILED here with the reason the worker would have given.
     */
    private void republishLostImports() {
        Instant staleBefore = clock.instant().minus(DemoPersistence.STALE_AFTER);
        List<Demo> lost = demos.findUntouchedSince(DemoStatus.QUEUED, staleBefore,
                PageRequest.of(0, settings.matchesPerRun()));
        for (Demo demo : lost) {
            long demoId = demo.getId();
            String matchId = demo.getMatch().getFaceitMatchId();
            Optional<URI> link = pastedLinks.peek(demoId);
            try {
                demoService.requestImport(matchId, link.orElse(null), Actor.system());
                log.warn("FACEIT sync: demo {} of match {} has been QUEUED for a long time; published its import again",
                        demoId, matchId);
            } catch (ConflictException e) {
                if (persistence.failIfStatus(demoId, DemoStatus.QUEUED, DemoImportWorker.PASTED_LINK_GONE)) {
                    metrics.failed(DemoMetrics.STAGE_IMPORT);
                    log.warn("FACEIT sync: demo {} of match {} was queued for a pasted link that is gone; FAILED", demoId,
                            matchId);
                }
            } catch (RuntimeException e) {
                log.warn("FACEIT sync: could not publish the import of demo {} of match {} again: {}", demoId, matchId,
                        e.toString());
            }
        }
    }
}
