package io.csfaceit.backend.demo;

import io.csfaceit.backend.auth.Access;
import io.csfaceit.backend.auth.Actor;
import io.csfaceit.backend.auth.ForbiddenException;
import io.csfaceit.backend.common.api.BadRequestException;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.demo.DemoPersistence.Queued;
import io.csfaceit.backend.demo.dto.DemoResponse;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.FaceitNotFoundException;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.match.DemoScoreboard;
import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.match.MatchService;
import io.csfaceit.backend.match.MatchSource;
import io.csfaceit.backend.messaging.DemoImportWorker;
import io.csfaceit.backend.messaging.DemoMessages;
import io.csfaceit.backend.messaging.DemoMessages.DemoImportRequested;
import io.csfaceit.backend.messaging.DemoMessages.DemoParsed;
import io.csfaceit.backend.messaging.DemoMetrics;
import io.csfaceit.backend.messaging.DemoStoredPublisher;
import io.csfaceit.backend.storage.StorageService;
import io.csfaceit.backend.usage.QuotaExceededException;
import io.csfaceit.backend.usage.UsageKind;
import io.csfaceit.backend.usage.UsageService;
import io.csfaceit.backend.usage.UsageService.Reservation;
import java.io.EOFException;
import java.io.InputStream;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.file.Path;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.zip.ZipException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.AmqpTemplate;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/**
 * Starts and reports the import of a match's demo, takes a demo that is uploaded by hand and asks for the analysis
 * of a parsed demo to be done again. Like
 * {@link MatchService} it opens no transaction itself: FACEIT and the storage are called with none open, the database
 * writes are the transactions of {@link DemoPersistence}, and the RabbitMQ message goes out only after they have
 * committed. Before a demo can be queued for parsing, the SteamIDs of the match's roster are stored
 * ({@link RosterSteamIdMapper}): the parser knows the players by SteamID only.
 *
 * <p>Each of the three requests is made by an {@link Actor}, and the first thing it does is ask {@link Access} whether
 * the actor may: the admin key and an administrator always, a user only for a match they played. The roster is FACEIT's
 * answer for the match (the cached gateway). When FACEIT cannot be asked and has no cached answer, the request of a
 * user fails with the answer of a FACEIT that is unavailable, before anything is stored: a roster that cannot be read
 * lets nobody in.
 *
 * <p>A matchmaking match ({@code mm-<id>}, {@link MatchSource#MATCHMAKING}) is never asked of FACEIT: its members are
 * its owner and the players of its analyzed demo ({@link Access#requireMatchmakingMember}), it has no roster to map and
 * no FACEIT demo address, so only a link or an upload brings its demo. One the database does not know yet is made by
 * its first demo: an upload, or an import by link, whose file has Valve's name of this very match
 * ({@link DemoFileName}). Whoever is signed in may bring it (the admin key too), and the match is theirs: its row is
 * created with them as its owner in the transaction that creates its demo, after every check that can refuse the
 * request, so that a refused request leaves no match behind (see {@link DemoPersistence#queueNewMatchmaking} and
 * {@link DemoPersistence#restoreNewMatchmaking}). From then on the rules of a stored match apply, also to the second of
 * two first demos that arrive at once, with one exception: a match whose demo never got as far as an analysis and has
 * failed is open to a first demo again, and whoever brings one with the right name takes the match over
 * ({@link DemoPersistence#isOpenToFirstDemo}), so that a file that is not the match's demo does not keep it for good.
 *
 * <p>A user does so much per day ({@link UsageService}): an import and a request for a missing analysis count as
 * {@link UsageKind#DEMO_IMPORT}, an upload as {@link UsageKind#DEMO_UPLOAD} (the controller takes that place, before
 * it receives the file). A request is counted only when it starts something, and the limit is the last thing that
 * refuses: the rules of {@link Access} and the state of the demo are asked first, so a request that would be refused
 * anyway neither uses a place nor learns that the limit is reached.
 */
@Service
public class DemoService {

    /**
     * The first upload of a matchmaking match the database does not know has a file whose name is not Valve's name of
     * this match. (A link's name has its own code, {@link DemoLinkRefusedException#DEMO_LINK_MISMATCH}.)
     */
    public static final String DEMO_FILE_MISMATCH = "DEMO_FILE_MISMATCH";

    private static final String DEMO_NOT_FOUND = "DEMO_NOT_FOUND";
    private static final String DEMO_URL_UNAVAILABLE = "DEMO_URL_UNAVAILABLE";
    private static final String DEMO_NOT_PARSED = "DEMO_NOT_PARSED";
    private static final String MATCH_NOT_FOUND = "MATCH_NOT_FOUND";

    private static final Logger log = LoggerFactory.getLogger(DemoService.class);

    private final MatchService matchService;
    private final MatchRepository matches;
    private final DemoRepository demos;
    private final DemoPersistence persistence;
    private final AmqpTemplate amqp;
    private final FaceitGateway faceit;
    private final RosterSteamIdMapper rosterSteamIds;
    private final StorageService storage;
    private final DemoStoredPublisher storedPublisher;
    private final DemoUploadProperties uploadProperties;
    private final DemoMetrics metrics;
    private final Access access;
    private final UsageService usage;
    private final FaceitDownloadsApi downloadsApi;
    private final LinkGuard linkGuard;
    private final PastedLinks pastedLinks;
    private final DemoScoreboard scoreboard;

    public DemoService(MatchService matchService, MatchRepository matches, DemoRepository demos,
                       DemoPersistence persistence, AmqpTemplate amqp, FaceitGateway faceit,
                       RosterSteamIdMapper rosterSteamIds, StorageService storage, DemoStoredPublisher storedPublisher,
                       DemoUploadProperties uploadProperties, DemoMetrics metrics, Access access,
                       UsageService usage, FaceitDownloadsApi downloadsApi, LinkGuard linkGuard,
                       PastedLinks pastedLinks, DemoScoreboard scoreboard) {
        this.scoreboard = scoreboard;
        this.matchService = matchService;
        this.matches = matches;
        this.demos = demos;
        this.persistence = persistence;
        this.amqp = amqp;
        this.faceit = faceit;
        this.rosterSteamIds = rosterSteamIds;
        this.storage = storage;
        this.storedPublisher = storedPublisher;
        this.uploadProperties = uploadProperties;
        this.metrics = metrics;
        this.access = access;
        this.usage = usage;
        this.downloadsApi = downloadsApi;
        this.linkGuard = linkGuard;
        this.pastedLinks = pastedLinks;
    }

    /**
     * Queues the import of the match's demo. The match is loaded from FACEIT and stored first (this also gives the
     * demo URL), then the {@code demos} row is created, or revived when its import FAILED or its message was lost
     * (it has been QUEUED for a long time without anything happening), and the {@code demo.import} message is
     * published once that row is committed. A STORED demo that has been untouched for as long (the parser has not
     * taken it, so its {@code demo.parse} message looks lost) is announced on {@code demo.parse} again, also without
     * a demo URL, and answered as it is: STORED. A demo that is QUEUED or STORED only recently, or further along, is
     * reported as it is, without a message, and without needing a demo URL. Repeating the request, also in parallel,
     * therefore leaves one row and sends one message. The SteamIDs of the roster are stored first, so that they are
     * in place long before the stored demo reaches the parser.
     *
     * <p>A request that queues something (the import, or the announcement of a stored demo again) is one demo import
     * of the actor's day. The place is taken in the transaction that queues, so the two stand or fall together, and it
     * is given back when the message could not be published after all. A request that finds the demo there or under
     * way and queues nothing is not counted, and is answered as before when the limit is reached; so is the second of
     * two requests at once of which the first took the last place. An import that is queued while the site has no
     * access to FACEIT's Downloads API is not counted either (see {@link #countsAsImport}).
     *
     * @param actor who asks; a user has to be in the roster of the match
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_IN_MATCH}: the user did not play the match
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match
     * @throws ConflictException {@code DEMO_URL_UNAVAILABLE}: the demo would have to be downloaded, but FACEIT has
     *         no demo for the match (yet)
     * @throws QuotaExceededException {@code IMPORT_LIMIT_REACHED}: the request would queue something and the user has
     *         no demo import left today; nothing is queued
     */
    public DemoResponse requestImport(Actor actor, String faceitMatchId) {
        return requestImport(faceitMatchId, null, actor);
    }

    /**
     * Like {@link #requestImport(Actor, String)}, from a link to the demo file that the actor pasted (the address their
     * browser downloaded it from), or as that method when {@code link} is null. The server fetches the link itself, so
     * it is checked before anything is queued, after the actor's right to the match: {@link LinkGuard}'s three steps
     * (shape, allow-list, public addresses; the download checks them again, for the link and for every redirect), and
     * the name of the file, which has to be this match's demo ({@link DemoFileName}). A refused link writes nothing and
     * counts nothing. The link does not go into the {@code demo.import} message: it is held in {@link PastedLinks} for
     * the worker, put there before the message is published. It is never logged; a refused host is, by name.
     *
     * <p>Everything else is as without a link: a demo that is there or under way is reported as it is and the link is
     * not used; a FAILED demo or a lost message is queued again, now with the link. A link does not need FACEIT to
     * have a demo address for the match, and its import always counts as one of the user's day, because unlike
     * FACEIT's own address without the Downloads API it can work.
     *
     * <p>For a matchmaking match the database does not know yet, the link makes the match: its name has been checked to
     * be Valve's name of this match, and the match is created, owned by the actor, in the transaction that queues its
     * demo and takes the place of the limit (see {@link #queueStep}). Without a link such a match is not found.
     *
     * @throws DemoLinkRefusedException {@code DEMO_LINK_INVALID}, {@code DEMO_LINK_HOST_NOT_ALLOWED} or
     *         {@code DEMO_LINK_MISMATCH}; nothing is queued or counted
     */
    public DemoResponse requestImport(String faceitMatchId, URI link, Actor actor) {
        requireMember(actor, faceitMatchId, link != null);
        if (link != null) {
            checkLink(faceitMatchId, link, actor);
        }
        // A matchmaking match has no FACEIT demo address and no FACEIT roster: only a link brings its demo.
        boolean matchmaking = MatchSource.isMatchmaking(faceitMatchId);
        String demoUrl = matchmaking ? null : matchService.getMatch(faceitMatchId).demoUrl();
        boolean demoUrlAvailable = link != null || (demoUrl != null && !demoUrl.isBlank());
        QueueStep step = queueStep(actor, faceitMatchId, link != null, demoUrlAvailable);

        // The place this request takes, if it queues something. A repeat of the step after a lost race starts from a
        // transaction that was rolled back, and the place it had taken with it.
        AtomicReference<Reservation> place = new AtomicReference<>();
        Queued queued;
        try {
            queued = persistWithRetry("demo of match " + faceitMatchId,
                    () -> {
                        place.set(null);
                        return step.queue(publish -> {
                            if (link != null || countsAsImport(publish)) {
                                place.set(usage.reserve(actor, UsageKind.DEMO_IMPORT));
                            }
                        });
                    })
                    .orElseThrow(() -> new ConflictException(DEMO_URL_UNAVAILABLE, matchmaking
                            ? "No demo address is known for match " + faceitMatchId
                                    + ": bring its demo by a link or upload the file"
                            : "FACEIT has no demo for match " + faceitMatchId));
        } catch (QuotaExceededException refused) {
            // A request of the same user that ran at the same moment (a double click) may have queued the demo and
            // taken the last place while this one waited for it. Then the demo stands, and asking for a demo that
            // stands is not counted: the look is repeated, and it refuses only if it would still queue something.
            queued = step.queue(publish -> {
                throw refused;
            }).orElseThrow(() -> refused);
        }
        Demo demo = queued.demo();
        try {
            switch (queued.publish()) {
                case IMPORT -> {
                    if (link != null) {
                        pastedLinks.put(demo.getId(), link);
                    }
                    publishImport(demo.getId(), faceitMatchId, demoUrl);
                }
                case PARSE -> publishParseAgain(demo, faceitMatchId);
                case NOTHING -> {
                    // The demo is reported as it is.
                }
            }
        } catch (RuntimeException e) {
            // Nothing was started: the message did not go out, and the demo is FAILED for the next request to queue.
            usage.release(place.get());
            if (link != null) {
                pastedLinks.take(demo.getId());
            }
            throw e;
        }
        return toResponse(faceitMatchId, demo);
    }

    /** One run of the transaction that queues the demo of the request's match (see {@link #queueStep}). */
    @FunctionalInterface
    private interface QueueStep {

        Optional<Queued> queue(Consumer<DemoPersistence.Publish> beforeQueued);
    }

    /**
     * The transaction that queues the demo, for the match of the request. A FACEIT match is stored first, with the
     * SteamIDs of its roster, and a stored matchmaking match is taken as it is. A link (whose name has been checked to
     * be Valve's name of the match) brings the first demo of a matchmaking match the database does not know, which the
     * transaction makes, and of one open to a first demo again ({@link DemoPersistence#isOpenToFirstDemo}), which it
     * takes over: either way the match is the actor's (nobody's for the admin key). Should the match turn out not to be
     * open under the transaction's lock (another request made it first, or brought a demo meanwhile), the rules of a
     * stored match are asked in that transaction ({@link #requireMatchmakingMember}). What the site does by itself
     * never takes up a demo that has a row (FAILED included).
     *
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: a matchmaking match the database does not know, and no link
     */
    private QueueStep queueStep(Actor actor, String matchId, boolean withLink, boolean demoUrlAvailable) {
        boolean reviveExisting = actor.kind() != Actor.Kind.SYSTEM;
        if (!MatchSource.isMatchmaking(matchId)) {
            long matchRowId = mapRosterSteamIds(matchId);
            return beforeQueued -> persistence.queue(matchRowId, demoUrlAvailable, reviveExisting, beforeQueued);
        }
        Optional<Long> stored = matches.findByFaceitMatchId(matchId).map(Match::getId);
        if (stored.isPresent() && !(withLink && persistence.isOpenToFirstDemo(stored.get()))) {
            long matchRowId = stored.get();
            return beforeQueued -> persistence.queue(matchRowId, demoUrlAvailable, reviveExisting, beforeQueued);
        }
        if (!withLink) {
            throw new NotFoundException(MATCH_NOT_FOUND, "Match not found: " + matchId);
        }
        return beforeQueued -> persistence.queueNewMatchmaking(matchId, actor.userId(),
                () -> requireMatchmakingMember(actor, matchId, false), beforeQueued);
    }

    /**
     * The address FACEIT gives for the match's demo, from the cached match (stored as a side effect); null or blank when
     * FACEIT has none (yet). For the sweep that republishes lost import messages.
     *
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match
     */
    public String faceitDemoUrl(String faceitMatchId) {
        return matchService.getMatch(faceitMatchId).demoUrl();
    }

    /**
     * Publishes the {@code demo.import} message of a demo again, for the sweep that has taken the demo over
     * ({@link DemoPersistence#claimStaleQueued}). A pasted link that is still held is kept for the worker and its time
     * renewed. A failed publish throws and changes nothing: the demo stays QUEUED, touched by the claim, and the sweep
     * looks at it again when it is stale again.
     */
    public void republishImport(long demoId, String faceitMatchId, String demoUrl) {
        pastedLinks.peek(demoId).ifPresent(link -> pastedLinks.put(demoId, link));
        amqp.convertAndSend(DemoMessages.EXCHANGE, DemoMessages.Q_IMPORT,
                new DemoImportRequested(demoId, faceitMatchId, demoUrl));
    }

    /**
     * Refuses a pasted link before anything is stored: the name of its file first, then its shape, host and addresses
     * ({@link LinkGuard}). A refusal is logged with the code and the host at most, never the link.
     */
    private void checkLink(String faceitMatchId, URI link, Actor actor) {
        try {
            // The name first: it costs nothing, and a link of another match is refused without a DNS lookup.
            if (!DemoFileName.matchIdOfLink(link).map(faceitMatchId::equalsIgnoreCase).orElse(false)) {
                throw DemoLinkRefusedException.mismatch(faceitMatchId);
            }
            try {
                linkGuard.check(link);
            } catch (UnknownHostException e) {
                throw DemoLinkRefusedException.unresolved(link.getHost());
            }
        } catch (DemoLinkRefusedException e) {
            log.info("Refused a demo link for match {} from {}: {} [{}]", faceitMatchId, describe(actor),
                    e.getMessage(), e.getCode());
            throw e;
        }
    }

    private static String describe(Actor actor) {
        return actor.userId() == null ? actor.kind().name() : "user " + actor.userId();
    }

    /**
     * Takes the demo file of the match from the caller instead of FACEIT. The file is stored as zstd whatever it came
     * as (raw, gzip, zstd or bzip2), under the key the import worker uses, and the demo becomes STORED and is announced
     * on {@code demo.parse} once that is committed. A manual upload stores from any status, so it also repairs a FAILED
     * import and, deliberately, parses a PARSED or ANALYZED demo again. An import that is still downloading never
     * overwrites the demo row afterwards (the worker checks that the demo is still QUEUED before it stores its file,
     * and {@link DemoPersistence#markStored} needs it to be QUEUED). The uploaded object is less safe: the import's
     * file replaces it when the import's check ran before the upload committed and the import's {@code put} ran
     * after the upload's own {@code put} (see {@link DemoPersistence#restore}). The match is loaded from FACEIT and
     * stored first, and its roster's SteamIDs are mapped, before the file is looked at. Every temporary file is
     * deleted, whatever happens.
     *
     * <p>That is what the admin key and an administrator do. A user has to be in the roster of the match, and cannot
     * replace a demo that is PARSED or ANALYZED: it holds the statistics and the highlights of all ten players. Both
     * are asked before the file is read ({@link #requireUploadAllowed}, which the controller has called already, before
     * it received the file, and which is called here again so that no caller can leave it out). Receiving and
     * normalizing a large file takes a while, so the status is looked at once more just before the file goes to the
     * storage: a demo that became PARSED in the meantime is not replaced. The looks take no lock, because the file
     * goes under the key the parsed demo has and cannot be taken back; what is left is the moment between the last
     * look and the {@code put}, in which a demo that becomes PARSED is parsed again from the user's file, which the
     * analysis then checks against the roster like any other.
     *
     * <p>A matchmaking match the database does not know yet is made by its first upload: the name of the file has to be
     * Valve's name of this match ({@link DemoFileName}; else 400 {@code DEMO_FILE_MISMATCH}), asked before the file is
     * read, and the match is created, owned by the actor (nobody for the admin key), in the transaction that stores the
     * demo row: after the file has been received, unpacked and stored, so that an upload that fails on its way (too
     * large, damaged) leaves no match behind. Should another request make the match first, the rules of a stored match
     * are asked ({@link #requireMatchmakingMember}) just before the file goes to the storage and once more in that
     * transaction; what is left is the moment of the {@code put} itself, as for the status above.
     *
     * @param actor who uploads
     * @param fileName the name the file came with, which the first upload of a matchmaking match is checked by
     * @param content the file, already known to be non-empty and to have a demo's file name; it is read once and not
     *        closed here
     * @param stored runs once the demo row is stored, which is the moment from which the upload has started something
     *        and counts against the limit per day whatever happens next; a caller that took a place for the upload
     *        gives it back when this fails without {@code stored} having run
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_IN_MATCH}: the user did not play the match
     * @throws ConflictException {@code DEMO_ALREADY_PARSED}: a user uploads over a demo that has been parsed
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match
     * @throws BadRequestException the file is a corrupt gzip or bzip2 archive; {@code DEMO_FILE_MISMATCH}: the first
     *         demo of a matchmaking match has another name
     * @throws MaxUploadSizeExceededException the file, or what it expands to, is larger than the allowed size
     */
    public DemoResponse upload(Actor actor, String faceitMatchId, String fileName, InputStream content,
                               Runnable stored) {
        requireUploadAllowed(actor, faceitMatchId);
        Function<String, Demo> restore;
        if (MatchSource.isMatchmaking(faceitMatchId)) {
            restore = matchmakingRestore(actor, faceitMatchId, fileName);
        } else {
            matchService.getMatch(faceitMatchId);
            long matchRowId = mapRosterSteamIds(faceitMatchId);
            restore = storageKey -> persistence.restore(matchRowId, storageKey);
        }

        String storageKey = DemoImportWorker.storageKey(faceitMatchId);
        boolean matchmaking = MatchSource.isMatchmaking(faceitMatchId);
        storeUpload(content, storageKey, () -> {
            requireDemoReplaceable(actor, faceitMatchId);
            // A matchmaking match that another request has made, or brought a demo for, while this file was received is
            // that request's: a file of someone who is no member must not take the place of its demo's file.
            if (matchmaking) {
                requireMatchmakingMember(actor, faceitMatchId, true);
            }
        });

        Demo demo = persistWithRetry("demo of match " + faceitMatchId, () -> restore.apply(storageKey));
        stored.run();
        log.info("Stored the uploaded demo {} of match {} as {}", demo.getId(), faceitMatchId, storageKey);
        storedPublisher.publish(demo.getId(), faceitMatchId, storageKey);
        return toResponse(faceitMatchId, demo);
    }

    /**
     * How an upload for a matchmaking match is stored, decided once its file's name is known. A match that is stored
     * and not open to a first demo takes the file as any demo (the rules of a stored match were asked before the
     * body). A file with Valve's name of the match brings its first demo: for a match the database does not know, and
     * for one open to a first demo again, which the upload then takes over
     * ({@link DemoPersistence#restoreNewMatchmaking}).
     * A file with another name is taken for an open match only from its owner, the admin key or an administrator (as
     * before, without a change of owner), and refused for anyone else, who could only have brought a first demo.
     *
     * @throws BadRequestException {@code DEMO_FILE_MISMATCH}
     */
    private Function<String, Demo> matchmakingRestore(Actor actor, String matchId, String fileName) {
        Optional<DemoScoreboard.StoredMatch> stored = scoreboard.find(matchId);
        boolean open = stored.isEmpty() || persistence.isOpenToFirstDemo(stored.get().id());
        if (open && namesMatch(fileName, matchId)) {
            return storageKey -> persistence.restoreNewMatchmaking(matchId, actor.userId(),
                    () -> requireMatchmakingMember(actor, matchId, false), storageKey);
        }
        if (stored.isEmpty() || (open && !isOwnerOfOpenMatch(actor, stored.get()))) {
            throw firstDemoNameMismatch(actor, matchId);
        }
        long matchRowId = stored.get().id();
        return storageKey -> persistence.restore(matchRowId, storageKey);
    }

    /**
     * Whether the actor may upload a file as the demo of the match, asked before a byte of the file is received: a
     * user has to be in the roster of the match and cannot replace a demo that has been parsed. Nothing is written.
     * The controller calls it before it reads the request's body, so that a caller who is refused has sent the server
     * nothing to keep.
     *
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_IN_MATCH}: the user did not play the match
     * @throws ConflictException {@code DEMO_ALREADY_PARSED}: a user uploads over a demo that has been parsed
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match (asked for a user only; for
     *         the key and an administrator {@link #upload} finds that out)
     */
    public void requireUploadAllowed(Actor actor, String faceitMatchId) {
        requireMember(actor, faceitMatchId, true);
        requireDemoReplaceable(actor, faceitMatchId);
    }

    private void requireDemoReplaceable(Actor actor, String faceitMatchId) {
        access.requireDemoReplaceable(actor,
                demos.findByMatchFaceitMatchId(faceitMatchId).map(Demo::getStatus).orElse(null));
    }

    /**
     * Asks for the analysis of the match's parsed demo to be done again, by announcing the demo on {@code demo.parsed}
     * as the parser does when it has parsed it. The facts the parser wrote are in the database, so the demo file is
     * not needed, and nothing is written here: the listener analyzes the demo, and the answer is the demo as it is now,
     * so a PARSED demo (the analysis failed, or has not been done yet) is still PARSED in it. FACEIT is asked for the
     * roster of the match (a cached answer) only for a PARSED demo, whose players are compared with it before the
     * analysis; an ANALYZED demo has passed that check and is analyzed again without FACEIT. Repeating the request is
     * harmless, the analysis is idempotent.
     *
     * <p>A user has to be in the roster of the match (FACEIT's cached answer is asked for that) and can ask only for
     * the analysis that is missing: while the demo is PARSED. Doing an analysis again is the admin key's and an
     * administrator's, for whom FACEIT is not asked here at all. Each request of a user that is announced is one demo
     * import of their day: nothing else bounds how often a member of the match could repeat it while the demo is
     * PARSED. The place is given back when the message could not be published.
     *
     * @param actor who asks
     * @throws NotFoundException {@code DEMO_NOT_FOUND}: the match has no demo
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_IN_MATCH}: the user did not play the match
     * @throws ConflictException {@code DEMO_NOT_PARSED}: the demo is not PARSED or ANALYZED, so there are no facts to
     *         analyze (yet, or any more); {@code DEMO_ALREADY_ANALYZED}: a user asks for an analysis that is done
     * @throws QuotaExceededException {@code IMPORT_LIMIT_REACHED}: the user has no demo import left today
     */
    public DemoResponse requestAnalysis(Actor actor, String faceitMatchId) {
        Demo demo = demos.findByMatchFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new NotFoundException(DEMO_NOT_FOUND, "Demo not found for match: " + faceitMatchId));
        requireMember(actor, faceitMatchId, false);
        if (demo.getStatus() != DemoStatus.PARSED && demo.getStatus() != DemoStatus.ANALYZED) {
            throw new ConflictException(DEMO_NOT_PARSED,
                    "The demo of match " + faceitMatchId + " is " + demo.getStatus() + ", not parsed");
        }
        access.requireDemoAwaitingAnalysis(actor, demo.getStatus());
        Reservation place = usage.reserve(actor, UsageKind.DEMO_IMPORT);
        try {
            amqp.convertAndSend(DemoMessages.EXCHANGE, DemoMessages.Q_PARSED,
                    new DemoParsed(demo.getId(), faceitMatchId));
        } catch (RuntimeException e) {
            usage.release(place);
            throw e;
        }
        log.info("Announced demo {} of match {} on {} to have it analyzed again", demo.getId(), faceitMatchId,
                DemoMessages.Q_PARSED);
        return toResponse(faceitMatchId, demo);
    }

    /**
     * Whether what a request is about to queue is counted as a demo import of the user's day. An import that cannot
     * work is not: without access to FACEIT's Downloads API ({@link FaceitDownloadsApi#isConfigured}, the question the
     * import worker asks to choose its way) the worker can only fetch FACEIT's own address of the demo, which ends at
     * once as {@code DOWNLOAD_NEEDS_ACCESS}; the demo is queued all the same, so that the page shows that answer, and
     * costs the user nothing. Announcing a stored demo again downloads nothing and is counted either way.
     */
    private boolean countsAsImport(DemoPersistence.Publish publish) {
        return publish != DemoPersistence.Publish.IMPORT || downloadsApi.isConfigured();
    }

    /** The stored state of the match's demo. */
    public DemoResponse get(String faceitMatchId) {
        Demo demo = demos.findByMatchFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new NotFoundException(DEMO_NOT_FOUND, "Demo not found for match: " + faceitMatchId));
        return toResponse(faceitMatchId, demo);
    }

    /**
     * Asks {@link Access} whether the actor played the match. FACEIT is asked for the roster only when the rule needs
     * it (never for the admin key or an administrator), and nothing has been stored or written when this refuses.
     *
     * @param bringsDemo whether the request brings a demo (an upload, an import), which for a matchmaking match may be
     *        its first one (see {@link #requireMatchmakingMember})
     * @throws NotFoundException {@code MATCH_NOT_FOUND}: FACEIT does not know the match
     * @throws io.csfaceit.backend.faceit.FaceitUnavailableException FACEIT cannot be asked and has no cached answer
     */
    private void requireMember(Actor actor, String faceitMatchId, boolean bringsDemo) {
        if (MatchSource.isMatchmaking(faceitMatchId)) {
            requireMatchmakingMember(actor, faceitMatchId, bringsDemo);
            return;
        }
        access.requireMatchMember(actor, () -> roster(faceitMatchId));
    }

    /**
     * The rule of {@link Access#requireMatchmakingMember} for a matchmaking match, from the database alone: its owner,
     * and once its demo is ANALYZED (it has passed the wrong-demo check) the SteamIDs of the demo's players. A request
     * that brings a demo may also bring the match's first one, and is then let through to the name rule and the limit
     * per day: for a match the database does not know, which is nobody's yet, and for one that is open to a first demo
     * again because its demo never got as far as an analysis and has failed ({@link DemoPersistence#isOpenToFirstDemo}:
     * a match someone claimed with a file that is not its demo does not stay theirs). The step that stores the demo
     * decides again under its lock. A request that brings no demo for a match the database does not know learns from
     * the step after this one that it is not found.
     */
    private void requireMatchmakingMember(Actor actor, String matchId, boolean bringsDemo) {
        if (actor.unlimited()) {
            return;
        }
        Optional<DemoScoreboard.StoredMatch> stored = scoreboard.find(matchId);
        if (stored.isEmpty()) {
            return;
        }
        DemoScoreboard.StoredMatch match = stored.get();
        if (bringsDemo && persistence.isOpenToFirstDemo(match.id())) {
            return;
        }
        access.requireMatchmakingMember(actor, match.ownerUserId(),
                () -> match.analyzed() ? scoreboard.steamIds(match.id()) : Set.of());
    }

    /**
     * Whether the actor passes the rules of a stored matchmaking match that is open to a first demo, whose demo has
     * never been analyzed: the admin key, an administrator, or its owner.
     */
    private static boolean isOwnerOfOpenMatch(Actor actor, DemoScoreboard.StoredMatch match) {
        return actor.unlimited() || (match.ownerUserId() != null && match.ownerUserId().equals(actor.userId()));
    }

    /** Whether the name of a file is Valve's name of this matchmaking match ({@link DemoFileName}). */
    private static boolean namesMatch(String fileName, String matchId) {
        return DemoFileName.matchId(fileName).map(matchId::equalsIgnoreCase).orElse(false);
    }

    /**
     * The refusal of a first demo of a matchmaking match whose file has another name. The first demo makes the match
     * (or takes it over), so its file has to say which match it is: its name has to be Valve's name of this match
     * ({@link DemoFileName}). Otherwise any file could make a match of any id.
     */
    private static BadRequestException firstDemoNameMismatch(Actor actor, String matchId) {
        log.info("Refused the first demo of match {} from {}: the file has another name [{}]", matchId,
                describe(actor), DEMO_FILE_MISMATCH);
        return new BadRequestException(DEMO_FILE_MISMATCH, "The file is not the demo of match " + matchId
                + ": a matchmaking match the site does not know yet is made by its first demo, whose name has to be "
                + "Valve's name of it, <match id>_<number>.dem.bz2 (or .dem), or "
                + "match730_<match id>_<number>_<number>.dem");
    }

    private FaceitMatch roster(String faceitMatchId) {
        try {
            return faceit.getMatch(faceitMatchId);
        } catch (FaceitNotFoundException e) {
            throw new NotFoundException(MATCH_NOT_FOUND, "Match not found: " + faceitMatchId);
        }
    }

    /**
     * Stores the SteamIDs of the roster of the (stored) match. FACEIT's answer comes from the cache that
     * {@code matchService.getMatch} has just filled.
     *
     * @return the id of the match's row
     */
    private long mapRosterSteamIds(String faceitMatchId) {
        rosterSteamIds.apply(faceit.getMatch(faceitMatchId));
        return matches.findByFaceitMatchId(faceitMatchId)
                .orElseThrow(() -> new IllegalStateException("Match " + faceitMatchId + " is not stored"))
                .getId();
    }

    /**
     * Copies the upload to a temporary file, normalizes it to zstd and puts it in storage. {@code beforePut} runs when
     * the file is ready and nothing has been put yet, and stops the upload by throwing; the temporary files go either
     * way.
     */
    private void storeUpload(InputStream content, String storageKey, Runnable beforePut) {
        Path received = null;
        Path normalized = null;
        try {
            received = DemoFiles.receive(content, uploadProperties.maxSize());
            normalized = DemoFiles.normalize(received, uploadProperties.maxSize());
            beforePut.run();
            storage.put(storageKey, normalized);
        } catch (DemoDownloadRejectedException e) {
            throw new MaxUploadSizeExceededException(uploadProperties.maxSize().toBytes(), e);
        } catch (DemoDownloadException e) {
            if (e.getCause() instanceof ZipException || e.getCause() instanceof EOFException) {
                throw new BadRequestException("The file is not a valid gzip archive");
            }
            if (e.getCause() instanceof DemoFiles.CorruptBzip2Exception) {
                throw new BadRequestException("The file is not a valid bzip2 archive");
            }
            throw e;
        } finally {
            DemoFiles.deleteQuietly(received);
            DemoFiles.deleteQuietly(normalized);
        }
    }

    /**
     * Publishes the import request. When that fails the row is already committed as QUEUED with nothing to process
     * it, so it is marked FAILED (the next import request queues it again), counted as a failed import, and the
     * failure reaches the caller.
     */
    private void publishImport(long demoId, String faceitMatchId, String demoUrl) {
        try {
            amqp.convertAndSend(DemoMessages.EXCHANGE, DemoMessages.Q_IMPORT,
                    new DemoImportRequested(demoId, faceitMatchId, demoUrl));
        } catch (RuntimeException e) {
            log.error("Could not publish {} for demo {} of match {}, marking the demo FAILED", DemoMessages.Q_IMPORT,
                    demoId, faceitMatchId, e);
            try {
                if (persistence.failUnpublished(demoId)) {
                    metrics.failed(DemoMetrics.STAGE_IMPORT);
                }
            } catch (RuntimeException markFailure) {
                log.error("Could not mark demo {} FAILED; it stays QUEUED without a message", demoId, markFailure);
                e.addSuppressed(markFailure);
            }
            throw e;
        }
    }

    /**
     * Announces a STORED demo whose {@code demo.parse} message looks lost ({@link DemoPersistence#queue} has touched
     * it, so that no other request sends the message too). Like every publish this follows the commit. A failed
     * publish is handled by {@link DemoStoredPublisher}: the demo is marked FAILED and the failure reaches the caller.
     */
    private void publishParseAgain(Demo demo, String faceitMatchId) {
        log.warn("Demo {} of match {} has been STORED for a long time without being parsed; publishing {} again",
                demo.getId(), faceitMatchId, DemoMessages.Q_PARSE);
        storedPublisher.publish(demo.getId(), faceitMatchId, demo.getStorageKey());
    }

    /**
     * Runs one persistence step and, if it loses a first-access race, runs it once more. Two requests that meet a
     * match without a demo both find nothing and both insert; PostgreSQL fails the loser's insert with a unique
     * violation (or, rarely, a deadlock), which aborts that transaction. The repeat is a new transaction that finds
     * the winner's row, and its result says not to publish. A second failure is real and propagates.
     */
    private static <T> T persistWithRetry(String what, Supplier<T> persist) {
        try {
            return persist.get();
        } catch (DataIntegrityViolationException | ConcurrencyFailureException e) {
            log.info("Lost a concurrent first-access write race for {} ({}), retrying once", what,
                    e.getClass().getSimpleName());
            return persist.get();
        }
    }

    /** Takes the FACEIT match id from the caller: the entity's match is lazy and not loaded here. */
    private static DemoResponse toResponse(String faceitMatchId, Demo demo) {
        return new DemoResponse(demo.getId(), faceitMatchId, demo.getStatus(), demo.getError(), demo.getErrorCode(),
                demo.getUpdatedAt());
    }
}
