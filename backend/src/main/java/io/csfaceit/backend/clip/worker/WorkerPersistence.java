package io.csfaceit.backend.clip.worker;

import io.csfaceit.backend.clip.Clip;
import io.csfaceit.backend.clip.ClipFacts;
import io.csfaceit.backend.clip.ClipKind;
import io.csfaceit.backend.clip.ClipQuality;
import io.csfaceit.backend.clip.ClipRepository;
import io.csfaceit.backend.clip.ClipSegment;
import io.csfaceit.backend.clip.ClipStatus;
import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.demo.Demo;
import io.csfaceit.backend.demo.DemoRepository;
import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.player.Player;
import java.sql.Types;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The database steps behind the recorder's API: taking a clip from the queue, every move of a clip a recorder holds,
 * and taking a clip back from a recorder that has gone quiet. It is a bean of its own so that the transaction proxy
 * applies; {@link WorkerService} calls the storage with no transaction open and comes in here for each short step.
 *
 * <p>One rule runs through all of it: a clip changes only under its row lock, and what decides the change is read
 * under that lock. A recorder's request takes the lock of its clip and then looks again at who holds the clip
 * ({@code claimed_by}) and in what status; the job that takes back silent clips takes the same lock and looks again
 * at the heartbeat. Whichever gets the lock first wins, and the other finds the clip as the winner left it: a progress
 * report that reaches the clip first keeps it from being taken back, and one that comes after the job has taken it
 * gets a {@code 409 CLIP_NOT_CLAIMED} and changes nothing. {@link Clip} checks neither who holds a clip nor a lock,
 * that is done here.
 */
@Component
public class WorkerPersistence {

    static final String CLIP_NOT_CLAIMED = "CLIP_NOT_CLAIMED";
    static final String CLIP_VIDEO_MISSING = "CLIP_VIDEO_MISSING";

    /** Why a queued clip is failed instead of claimed; not retried, nothing a later attempt does can change it. */
    static final String DEMO_GONE = "The demo file is no longer stored";
    static final String STEAM_ID_UNKNOWN = "The player's Steam ID is not known";

    /** The values of {@code clip_workers.state}. */
    static final String STATE_IDLE = "IDLE";
    static final String STATE_WORKING = "WORKING";

    private static final List<ClipStatus> ACTIVE_STATUSES =
            Arrays.stream(ClipStatus.values()).filter(ClipStatus::isActive).toList();

    private static final String UPSERT_WORKER_SQL = """
            INSERT INTO clip_workers (name, version, mode, state, current_clip_id, last_seen_at)
            VALUES (:name, :version, :mode, :state, :clipId, :seenAt)
            ON CONFLICT (name) DO UPDATE SET
              version = COALESCE(EXCLUDED.version, clip_workers.version),
              mode = COALESCE(EXCLUDED.mode, clip_workers.mode),
              state = EXCLUDED.state,
              current_clip_id = EXCLUDED.current_clip_id,
              last_seen_at = EXCLUDED.last_seen_at""";

    /**
     * A clip taken from the queue, with what a recorder needs of it except the size of the demo file (which only the
     * storage can tell). {@code attempts} is the number of this attempt, 1 for the first.
     */
    public record ClaimedClip(long clipId, ClipKind kind, String matchId, String mapName, String focusSteamId,
                              int tickRate, List<ClipSegment> segments, int width, int height, int fps, int attempts,
                              String demoStorageKey, String demoVersion) {
    }

    /** What one turn of the claim came to. */
    public sealed interface Turn {

        /** No clip of the qualities asked for is waiting. */
        record NothingWaiting() implements Turn {
        }

        /** The oldest waiting clip could not be recorded and was failed; the next one is to be taken. */
        record Rejected(long clipId, String reason) implements Turn {
        }

        /** The oldest waiting clip is now held by the recorder. */
        record Taken(ClaimedClip clip) implements Turn {
        }
    }

    /** How an attempt ended for the clip: it waits to be recorded again, or it is given up. */
    public enum Fate {
        REQUEUED,
        FAILED
    }

    /** What became of a clip an attempt ended on, with the number of attempts it has had. */
    public record Ended(Fate fate, int attempts) {
    }

    private final ClipRepository clips;
    private final DemoRepository demos;
    private final JdbcClient jdbc;
    private final Clock clock;

    public WorkerPersistence(ClipRepository clips, DemoRepository demos, JdbcClient jdbc, Clock clock) {
        this.clips = clips;
        this.demos = demos;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /**
     * One turn of the claim: the oldest waiting clip of the given qualities is locked, skipping any another recorder's
     * transaction holds, and either claimed or, if it cannot be recorded, failed. The clip cannot be recorded when the
     * demo of its match has no stored file (or is not parsed), or its player's Steam ID is not known; it is failed
     * with that reason and not retried. Either way the recorder is seen, as {@code IDLE} unless it got a clip.
     *
     * @param qualities the qualities the recorder can record, not empty
     */
    @Transactional
    public Turn claimNext(String worker, String version, String mode, Set<ClipQuality> qualities) {
        List<String> labels = qualities.stream().map(ClipQuality::label).toList();
        Clip clip = clips.lockOldestWaiting(ClipStatus.QUEUED.name(), labels).orElse(null);
        if (clip == null) {
            touchWorker(worker, version, mode, STATE_IDLE, null);
            return new Turn.NothingWaiting();
        }

        Match match = clip.getMatch();
        Player player = clip.getPlayer();
        Demo demo = demos.findByMatchId(match.getId()).filter(ClipFacts::hasStoredFile).orElse(null);
        String refusal = null;
        if (demo == null) {
            refusal = DEMO_GONE;
        } else if (player.getSteamId() == null || player.getSteamId().isBlank()) {
            refusal = STEAM_ID_UNKNOWN;
        }
        if (refusal != null) {
            clip.fail(refusal);
            clips.saveAndFlush(clip);
            touchWorker(worker, version, mode, STATE_IDLE, null);
            return new Turn.Rejected(clip.getId(), refusal);
        }

        clip.claim(worker);
        clips.saveAndFlush(clip);
        touchWorker(worker, version, mode, STATE_WORKING, clip.getId());
        return new Turn.Taken(new ClaimedClip(clip.getId(), clip.getKind(), match.getFaceitMatchId(),
                match.getMapName(), player.getSteamId(), ClipFacts.tickRate(demo.getTickRate()),
                List.copyOf(clip.getSegments()), clip.getQuality().width(), clip.getQuality().height(), clip.getFps(),
                clip.getAttempts(), demo.getStorageKey(), String.valueOf(demo.getUpdatedAt().toEpochMilli())));
    }

    /**
     * Checks that the recorder holds the clip: it is claimed by it and in an active status. A look and no lock, for the
     * recorder's requests that do their work before they change anything; the change itself looks again under the
     * lock.
     *
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}
     */
    @Transactional(readOnly = true)
    public void requireHeldBy(long clipId, String worker) {
        if (!clips.isHeldBy(clipId, worker, ACTIVE_STATUSES)) {
            throw notClaimed(clipId);
        }
    }

    /**
     * The storage key of the demo of the clip's match, if the recorder may be given the file: it holds the clip, and
     * the file is stored (see {@link ClipFacts#hasStoredFile}).
     *
     * @return empty when the demo cannot be given
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}
     */
    @Transactional(readOnly = true)
    public Optional<String> storedDemoKey(long clipId, String worker) {
        Clip clip = clips.findById(clipId).filter(held -> isHeldBy(held, worker)).orElseThrow(() -> notClaimed(clipId));
        return demos.findByMatchId(clip.getMatch().getId()).filter(ClipFacts::hasStoredFile).map(Demo::getStorageKey);
    }

    /**
     * Records the recorder's report: the clip moves to {@code stage} with {@code percent} done, and its heartbeat is
     * refreshed.
     *
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}
     */
    @Transactional
    public void progress(long clipId, String worker, ClipStatus stage, int percent) {
        Clip clip = lockHeldBy(clipId, worker);
        clip.progress(stage, percent);
        clips.saveAndFlush(clip);
        touchWorker(worker, null, null, STATE_WORKING, clipId);
    }

    /**
     * Records that the video is in storage: the clip becomes {@code UPLOADING}. The claim is looked at again under the
     * lock, as the upload took a while, and a recorder that has lost the clip meanwhile changes nothing.
     *
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}
     */
    @Transactional
    public void videoStored(long clipId, String worker, String videoKey, long sizeBytes) {
        Clip clip = lockHeldBy(clipId, worker);
        clip.videoStored(videoKey, sizeBytes);
        clips.saveAndFlush(clip);
    }

    /**
     * Records that the thumbnail is in storage, with the same look under the lock as {@link #videoStored}.
     *
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}
     */
    @Transactional
    public void thumbnailStored(long clipId, String worker, String thumbnailKey) {
        Clip clip = lockHeldBy(clipId, worker);
        clip.thumbnailStored(thumbnailKey);
        clips.saveAndFlush(clip);
    }

    /**
     * Finishes the clip: {@code DONE}, with the length and picture size of the video. There has to be a video, the one
     * this attempt uploaded ({@link Clip#requeue} forgets the video of an attempt that was given up).
     *
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}, or {@code CLIP_VIDEO_MISSING} when no video was uploaded
     */
    @Transactional
    public void complete(long clipId, String worker, int durationMs, int width, int height) {
        Clip clip = lockHeldBy(clipId, worker);
        if (clip.getVideoKey() == null) {
            throw new ConflictException(CLIP_VIDEO_MISSING, "Clip " + clipId + " has no uploaded video to complete");
        }
        clip.complete(durationMs, width, height);
        clips.saveAndFlush(clip);
    }

    /**
     * Ends the recorder's attempt with {@code error}: back to the queue when it may be tried again
     * ({@code retryable}, and fewer than {@code maxAttempts} attempts so far), otherwise given up.
     *
     * @throws ConflictException {@code CLIP_NOT_CLAIMED}
     */
    @Transactional
    public Ended fail(long clipId, String worker, String error, boolean retryable, int maxAttempts) {
        return endAttempt(lockHeldBy(clipId, worker), error, retryable, maxAttempts);
    }

    /** Notes that the recorder is there, and what it is doing. The clip it names, if any, is not touched. */
    @Transactional
    public void heartbeat(String worker, String version, String mode, String state, Long clipId) {
        touchWorker(worker, version, mode, state, clipId);
    }

    /**
     * The ids of the active clips whose recorder has been silent since before {@code cutoff}. A look and no lock:
     * {@link #takeBackIfSilent} looks again at each, under its lock.
     */
    @Transactional(readOnly = true)
    public List<Long> findSilentClips(Instant cutoff) {
        return clips.findSilentIds(ACTIVE_STATUSES, cutoff);
    }

    /**
     * Takes the clip back from its recorder if it is still silent: active, and no sign of life since before
     * {@code cutoff}, both looked at under the lock. A report that has come in meanwhile has refreshed the heartbeat,
     * or the clip is not active any more (finished, failed, queued again, deleted), and then nothing is changed. A
     * clip that has been taken back goes to the queue again, or is failed when it has had {@code maxAttempts} attempts.
     *
     * @return what became of the clip, or empty when it was not silent any more
     */
    @Transactional
    public Optional<Ended> takeBackIfSilent(long clipId, Instant cutoff, String error, int maxAttempts) {
        Clip clip = clips.findByIdForUpdate(clipId).orElse(null);
        if (clip == null || !clip.getStatus().isActive()
                || (clip.getHeartbeatAt() != null && !clip.getHeartbeatAt().isBefore(cutoff))) {
            return Optional.empty();
        }
        return Optional.of(endAttempt(clip, error, true, maxAttempts));
    }

    /** The clip locked, provided the recorder holds it. */
    private Clip lockHeldBy(long clipId, String worker) {
        Clip clip = clips.findByIdForUpdate(clipId).orElseThrow(() -> notClaimed(clipId));
        if (!isHeldBy(clip, worker)) {
            throw notClaimed(clipId);
        }
        return clip;
    }

    private static boolean isHeldBy(Clip clip, String worker) {
        return clip.getStatus().isActive() && worker.equals(clip.getClaimedBy());
    }

    /** Back to the queue while there are attempts left and the attempt may be repeated, otherwise given up. */
    private Ended endAttempt(Clip clip, String error, boolean retryable, int maxAttempts) {
        Fate fate;
        if (retryable && clip.getAttempts() < maxAttempts) {
            clip.requeue(error);
            fate = Fate.REQUEUED;
        } else {
            clip.fail(error);
            fate = Fate.FAILED;
        }
        clips.saveAndFlush(clip);
        return new Ended(fate, clip.getAttempts());
    }

    /**
     * Notes in {@code clip_workers} that the recorder has been seen now. A recorder that is not there yet is added; a
     * {@code version} or {@code mode} that is not given leaves the one on record.
     */
    private void touchWorker(String worker, String version, String mode, String state, Long clipId) {
        jdbc.sql(UPSERT_WORKER_SQL)
                .param("name", worker)
                .param("version", version, Types.VARCHAR)
                .param("mode", mode, Types.VARCHAR)
                .param("state", state)
                .param("clipId", clipId, Types.BIGINT)
                .param("seenAt", OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC))
                .update();
    }

    private static ConflictException notClaimed(long clipId) {
        return new ConflictException(CLIP_NOT_CLAIMED, "Clip " + clipId + " is not held by this recorder");
    }
}
