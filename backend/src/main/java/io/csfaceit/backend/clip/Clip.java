package io.csfaceit.backend.clip;

import io.csfaceit.backend.analysis.highlight.HighlightType;
import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.player.Player;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One clip: a video to be cut from the stored demo of a match, by the segments in {@code segments}, as seen from
 * {@code player}. The row is the queue entry, and a recorder works it through the statuses of {@link ClipStatus}.
 *
 * <p>A clip of a highlight keeps no reference to the highlight row, which an analysis replaces: it finds its highlight
 * again by {@code (match, player, highlightType, roundNumber, tickStart)}. {@code tickStart} and {@code tickEnd} are
 * the highlight's own window; the video is made of {@code segments}, which lie inside it. The three fields are
 * {@code null} in a compilation.
 *
 * <p>{@code requestedBy} is the id of the user whose session ordered the clip, and is what makes a clip somebody's own:
 * only that user (and the admin key and an administrator) may delete or retry it. It is {@code null} for a clip ordered
 * with the admin key, which nobody in particular ordered, and it never changes once the row is there.
 *
 * <p>The status changes only through the methods below, and any move they do not list throws an
 * {@link IllegalStateException}: a caller has the row under lock and has already decided what it wants, so a wrong
 * move is a bug in the caller. {@code DONE} and {@code FAILED} are final. Every move refreshes {@code updatedAt}.
 * <ul>
 *   <li>{@link #claim}: {@code QUEUED} to {@code RECORDING}, a recorder takes the clip, an attempt is counted and
 *       the reason the last attempt failed is forgotten.
 *   <li>{@link #progress}: from one active status to any active status, with the percent done.
 *   <li>{@link #videoStored}: an active clip becomes {@code UPLOADING}, the video is in storage.
 *   <li>{@link #thumbnailStored}: the thumbnail is in storage; the status stays.
 *   <li>{@link #complete}: an active clip becomes {@code DONE}.
 *   <li>{@link #fail}: a {@code QUEUED} or active clip becomes {@code FAILED}.
 *   <li>{@link #requeue}: an active clip goes back to {@code QUEUED}, to be recorded again.
 *   <li>{@link #release}: a clip that was just claimed goes back to {@code QUEUED} together with its attempt, because
 *       the recorder could not be told of it.
 * </ul>
 */
@Entity
@Table(name = "clips")
public class Clip {

    private static final int PERCENT_MAX = 100;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "match_id", nullable = false)
    private Match match;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "player_id", nullable = false)
    private Player player;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, length = 16)
    private ClipKind kind;

    @Enumerated(EnumType.STRING)
    @Column(name = "highlight_type", length = 32)
    private HighlightType highlightType;

    @Column(name = "round_number")
    private Integer roundNumber;

    @Column(name = "tick_start")
    private Integer tickStart;

    @Column(name = "tick_end")
    private Integer tickEnd;

    @Convert(converter = ClipQuality.ColumnConverter.class)
    @Column(name = "quality", nullable = false, length = 8)
    private ClipQuality quality;

    @Column(name = "fps", nullable = false)
    private int fps;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "segments", nullable = false)
    private List<ClipSegment> segments;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private ClipStatus status;

    @Column(name = "progress", nullable = false)
    private int progress;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "error", columnDefinition = "TEXT")
    private String error;

    @Enumerated(EnumType.STRING)
    @Column(name = "error_code", length = 32)
    private ClipErrorCode errorCode;

    @Column(name = "claimed_by", length = 64)
    private String claimedBy;

    @Column(name = "claimed_at")
    private Instant claimedAt;

    @Column(name = "heartbeat_at")
    private Instant heartbeatAt;

    @Column(name = "video_key", length = 255)
    private String videoKey;

    @Column(name = "thumbnail_key", length = 255)
    private String thumbnailKey;

    @Column(name = "duration_ms")
    private Integer durationMs;

    @Column(name = "size_bytes")
    private Long sizeBytes;

    @Column(name = "width")
    private Integer width;

    @Column(name = "height")
    private Integer height;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    /** The id of the user who ordered the clip; a plain id, because nothing here reads the user. */
    @Column(name = "requested_by", updatable = false)
    private Long requestedBy;

    protected Clip() {
    }

    private Clip(Match match, Player player, ClipKind kind, ClipQuality quality, int fps, List<ClipSegment> segments,
                 Long requestedBy) {
        this.match = match;
        this.player = player;
        this.kind = kind;
        this.quality = quality;
        this.fps = fps;
        this.segments = List.copyOf(segments);
        this.status = ClipStatus.QUEUED;
        this.requestedBy = requestedBy;
    }

    /**
     * A new clip of a highlight, waiting in the queue. {@code tickStart} and {@code tickEnd} are the highlight's.
     *
     * @param requestedBy the id of the user who orders it, or {@code null} when it is ordered with the admin key
     */
    public static Clip highlight(Match match, Player player, HighlightType type, int roundNumber, int tickStart,
                                 int tickEnd, ClipQuality quality, int fps, List<ClipSegment> segments,
                                 Long requestedBy) {
        Clip clip = new Clip(match, player, ClipKind.HIGHLIGHT, quality, fps, segments, requestedBy);
        clip.highlightType = type;
        clip.roundNumber = roundNumber;
        clip.tickStart = tickStart;
        clip.tickEnd = tickEnd;
        return clip;
    }

    /**
     * A new compilation of the kills of {@code player} in {@code match}, waiting in the queue. It is made for no
     * highlight and no window, so the fields of those stay {@code null}.
     *
     * @param requestedBy the id of the user who orders it, or {@code null} when it is ordered with the admin key
     */
    public static Clip compilation(Match match, Player player, ClipQuality quality, int fps,
                                   List<ClipSegment> segments, Long requestedBy) {
        return new Clip(match, player, ClipKind.COMPILATION, quality, fps, segments, requestedBy);
    }

    @PrePersist
    void onCreate() {
        Instant now = now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        this.updatedAt = now();
    }

    /** PostgreSQL stores microseconds; truncating keeps the value in memory equal to the one read back later. */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    /**
     * A recorder takes the clip: {@code QUEUED} becomes {@code RECORDING}, owned by {@code worker}, with no progress
     * and one more attempt counted. The claim and its heartbeat start now. The {@code error} of the attempt before
     * goes: it is shown while the clip waits to be recorded again (see {@link #requeue}), not once it is being
     * recorded.
     */
    public void claim(String worker) {
        if (status != ClipStatus.QUEUED) {
            throw illegal("be claimed by " + worker);
        }
        Instant now = now();
        this.status = ClipStatus.RECORDING;
        this.claimedBy = worker;
        this.claimedAt = now;
        this.heartbeatAt = now;
        this.progress = 0;
        this.attempts++;
        this.error = null;
        this.errorCode = null;
        this.updatedAt = now;
    }

    /**
     * The recorder reports that it is in {@code stage}, {@code percent} done. Both the clip and {@code stage} have to
     * be active; the stage may be any active one, also an earlier one. This is also the recorder's sign of life.
     *
     * @throws IllegalArgumentException {@code percent} is not from 0 to 100
     */
    public void progress(ClipStatus stage, int percent) {
        if (!status.isActive() || !stage.isActive()) {
            throw illegal("move to " + stage + " with a progress report");
        }
        if (percent < 0 || percent > PERCENT_MAX) {
            throw new IllegalArgumentException("Progress must be from 0 to 100: " + percent);
        }
        Instant now = now();
        this.status = stage;
        this.progress = percent;
        this.heartbeatAt = now;
        this.updatedAt = now;
    }

    /** The recorder has put the video in storage under {@code videoKey}: an active clip becomes {@code UPLOADING}. */
    public void videoStored(String videoKey, long sizeBytes) {
        requireActive("store a video");
        Instant now = now();
        this.status = ClipStatus.UPLOADING;
        this.videoKey = videoKey;
        this.sizeBytes = sizeBytes;
        this.heartbeatAt = now;
        this.updatedAt = now;
    }

    /** The recorder has put the thumbnail in storage under {@code thumbnailKey}; the status stays. */
    public void thumbnailStored(String thumbnailKey) {
        requireActive("store a thumbnail");
        Instant now = now();
        this.thumbnailKey = thumbnailKey;
        this.heartbeatAt = now;
        this.updatedAt = now;
    }

    /**
     * The video is ready: an active clip becomes {@code DONE}, 100 percent, with the length and the picture size of
     * the file that was recorded. A finished clip has nothing to report, so the {@code error} of an earlier failed
     * attempt goes.
     */
    public void complete(int durationMs, int width, int height) {
        requireActive("be completed");
        Instant now = now();
        this.status = ClipStatus.DONE;
        this.durationMs = durationMs;
        this.width = width;
        this.height = height;
        this.progress = PERCENT_MAX;
        this.error = null;
        this.errorCode = null;
        this.finishedAt = now;
        this.updatedAt = now;
    }

    /**
     * The clip is given up for good: a {@code QUEUED} or active clip becomes {@code FAILED} with the reason in
     * {@code error}, and its code when the backend found the reason itself ({@code null} for a reason the recorder
     * reported). It is finished, so {@code finishedAt} is set as it is for {@code DONE}; the clean-up of old clips
     * selects both by it.
     */
    public void fail(String error, ClipErrorCode errorCode) {
        if (status != ClipStatus.QUEUED && !status.isActive()) {
            throw illegal("fail");
        }
        Instant now = now();
        this.status = ClipStatus.FAILED;
        this.error = error;
        this.errorCode = errorCode;
        this.finishedAt = now;
        this.updatedAt = now;
    }

    /**
     * The attempt is over and the clip is to be recorded again: an active clip goes back to {@code QUEUED} with the
     * reason of the failed attempt in {@code error} and, when the backend found it itself, in {@code errorCode}; both
     * stay until the next {@link #claim}. {@code attempts} stays. The claim, the progress and everything the attempt
     * uploaded are forgotten, so that the next attempt cannot be completed with the previous one's video.
     */
    public void requeue(String error, ClipErrorCode errorCode) {
        requireActive("be queued again");
        this.error = error;
        this.errorCode = errorCode;
        forgetAttempt();
    }

    /**
     * The recorder was never told that it holds the clip (the answer to its claim could not be made, for instance
     * because the storage could not be asked for the demo): an active clip goes back to {@code QUEUED} as if it had
     * not been claimed. What {@link #requeue} forgets is forgotten, and the attempt that the claim counted is given
     * back, so that claims which came to nothing do not use a clip up. {@code error} stays as it is: the claim cleared
     * it, and nothing has happened to the clip since.
     */
    public void release() {
        requireActive("be given back");
        forgetAttempt();
        this.attempts = Math.max(0, attempts - 1);
    }

    /** Back in the queue: the claim, the progress and everything the attempt uploaded are forgotten. */
    private void forgetAttempt() {
        this.status = ClipStatus.QUEUED;
        this.claimedBy = null;
        this.claimedAt = null;
        this.heartbeatAt = null;
        this.progress = 0;
        this.videoKey = null;
        this.thumbnailKey = null;
        this.sizeBytes = null;
        this.updatedAt = now();
    }

    private void requireActive(String what) {
        if (!status.isActive()) {
            throw illegal(what);
        }
    }

    private IllegalStateException illegal(String what) {
        return new IllegalStateException("Clip " + id + " is " + status + " and cannot " + what);
    }

    public Long getId() {
        return id;
    }

    public Match getMatch() {
        return match;
    }

    public Player getPlayer() {
        return player;
    }

    public ClipKind getKind() {
        return kind;
    }

    public HighlightType getHighlightType() {
        return highlightType;
    }

    public Integer getRoundNumber() {
        return roundNumber;
    }

    public Integer getTickStart() {
        return tickStart;
    }

    public Integer getTickEnd() {
        return tickEnd;
    }

    public ClipQuality getQuality() {
        return quality;
    }

    public int getFps() {
        return fps;
    }

    public List<ClipSegment> getSegments() {
        return segments;
    }

    public ClipStatus getStatus() {
        return status;
    }

    public int getProgress() {
        return progress;
    }

    public int getAttempts() {
        return attempts;
    }

    public String getError() {
        return error;
    }

    public ClipErrorCode getErrorCode() {
        return errorCode;
    }

    public String getClaimedBy() {
        return claimedBy;
    }

    public Instant getClaimedAt() {
        return claimedAt;
    }

    public Instant getHeartbeatAt() {
        return heartbeatAt;
    }

    public String getVideoKey() {
        return videoKey;
    }

    public String getThumbnailKey() {
        return thumbnailKey;
    }

    public Integer getDurationMs() {
        return durationMs;
    }

    public Long getSizeBytes() {
        return sizeBytes;
    }

    public Integer getWidth() {
        return width;
    }

    public Integer getHeight() {
        return height;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public Long getRequestedBy() {
        return requestedBy;
    }
}
