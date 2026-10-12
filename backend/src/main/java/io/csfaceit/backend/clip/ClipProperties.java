package io.csfaceit.backend.clip;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import java.time.Duration;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;
import org.springframework.validation.annotation.Validated;

/**
 * Binds the {@code clip.*} block of {@code application.yml}: the queue of clips to record, the rules that cut a clip
 * into segments and how long a finished clip is kept. The application refuses to start with a count, a time span or
 * a size that is not positive, so a rule never runs with a limit of 0.
 *
 * @param workerToken the secret a recorder sends in {@code X-Worker-Token}; empty while none is set, and then every
 *        worker request is refused. It is never logged: {@link #toString} hides it.
 * @param fps the frames per second of a recording, whatever its quality
 * @param preSeconds how long a segment starts before a kill of the player
 * @param postSeconds how long a segment ends after a kill of the player
 * @param mergeGapSeconds two segments that are less than this far apart are one segment
 * @param maxDurationSeconds the most the segments of one clip may add up to
 * @param maxQueued how many clips may wait in the queue; a soft limit, two simultaneous requests may pass it by one
 * @param maxAttempts how many times a clip is recorded before it is given up
 * @param staleAfter how long an active clip may go without a sign of life from its recorder before it is taken back
 * @param workerOnlineWithin how recently a recorder must have been seen to count as online
 * @param retentionDays a finished clip is kept this many days; 0 keeps it forever
 * @param retentionCron when the clean-up of expired clips runs: Spring's six cron fields, server time
 * @param uploadMaxSize the most a recorder may upload for one clip
 */
@Validated
@ConfigurationProperties(prefix = "clip")
public record ClipProperties(
        String workerToken,
        @Positive int fps,
        @Positive int preSeconds,
        @Positive int postSeconds,
        @Positive int mergeGapSeconds,
        @Positive int maxDurationSeconds,
        @Positive int maxQueued,
        @Positive int maxAttempts,
        @NotNull @DurationMin(nanos = 1) Duration staleAfter,
        @NotNull @DurationMin(nanos = 1) Duration workerOnlineWithin,
        @PositiveOrZero int retentionDays,
        @NotBlank String retentionCron,
        @NotNull DataSize uploadMaxSize) {

    /** Spring's {@link DataSize} has no constraint of its own; a missing size is for {@code @NotNull} to report. */
    @AssertTrue(message = "clip.upload-max-size must be positive")
    boolean isUploadMaxSizePositive() {
        return uploadMaxSize == null || uploadMaxSize.toBytes() > 0;
    }

    /** Keeps the secret out of logs and exception messages that print the properties. */
    @Override
    public String toString() {
        return "ClipProperties[workerToken=***, fps=" + fps + ", preSeconds=" + preSeconds
                + ", postSeconds=" + postSeconds + ", mergeGapSeconds=" + mergeGapSeconds
                + ", maxDurationSeconds=" + maxDurationSeconds + ", maxQueued=" + maxQueued
                + ", maxAttempts=" + maxAttempts + ", staleAfter=" + staleAfter
                + ", workerOnlineWithin=" + workerOnlineWithin + ", retentionDays=" + retentionDays
                + ", retentionCron=" + retentionCron + ", uploadMaxSize=" + uploadMaxSize + "]";
    }
}
