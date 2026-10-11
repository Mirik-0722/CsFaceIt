package io.csfaceit.backend.demo;

import io.csfaceit.backend.match.Match;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * The demo of one match and its place in the pipeline. {@code error} says why the demo FAILED and is cleared when
 * the demo leaves that status. A PARSED demo whose analysis failed also has an {@code error} (see
 * {@link DemoRepository#noteError}, which leaves {@code updatedAt} alone); it stays PARSED, because the facts the
 * parser wrote are intact, and the error goes when the demo is analyzed or stored again.
 */
@Entity
@Table(name = "demos")
public class Demo {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "match_id", nullable = false, unique = true)
    private Match match;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private DemoStatus status;

    @Column(name = "storage_key", length = 255)
    private String storageKey;

    @Column(name = "error", columnDefinition = "TEXT")
    private String error;

    @Column(name = "tick_rate")
    private Integer tickRate;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Demo() {
    }

    /** A new demo is always {@link DemoStatus#QUEUED}. */
    public Demo(Match match) {
        this.match = match;
        this.status = DemoStatus.QUEUED;
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

    /**
     * Records that something just happened to the demo without changing its status: {@code updatedAt} is set here
     * because a JPA lifecycle callback runs only for an entity that is already dirty.
     */
    public void touch() {
        this.updatedAt = now();
    }

    /** PostgreSQL stores microseconds; truncating keeps the value in memory equal to the one read back later. */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    /**
     * Moves the demo to {@code next}: QUEUED to STORED, STORED to PARSED, PARSED to ANALYZED, any status to FAILED,
     * and FAILED back to QUEUED or on to STORED. Anything else is a bug in the caller. Leaving FAILED clears the
     * error; use {@link #fail} to enter FAILED with a reason. A manual upload does not go through here, it uses
     * {@link #restore}.
     */
    public void transitionTo(DemoStatus next) {
        if (!isAllowed(status, next)) {
            throw new IllegalStateException("Demo " + id + " cannot move from " + status + " to " + next);
        }
        this.status = next;
        if (next != DemoStatus.FAILED) {
            this.error = null;
        }
    }

    /**
     * Puts the demo in STORED with {@code storageKey}, from whatever status it has: a manual upload deliberately
     * stores the file again, also for a demo that is already PARSED or ANALYZED (it is then parsed again), and
     * replaces whatever an earlier attempt left. The error is cleared and {@code updatedAt} is refreshed. This is
     * not a transition of the pipeline's status machine, which is why it is not part of {@link #transitionTo}.
     */
    public void restore(String storageKey) {
        this.status = DemoStatus.STORED;
        this.storageKey = storageKey;
        this.error = null;
        touch();
    }

    /** Moves the demo to FAILED and records why. */
    public void fail(String error) {
        transitionTo(DemoStatus.FAILED);
        this.error = error;
    }

    private static boolean isAllowed(DemoStatus from, DemoStatus to) {
        if (to == DemoStatus.FAILED) {
            return true;
        }
        return switch (from) {
            case QUEUED -> to == DemoStatus.STORED;
            case STORED -> to == DemoStatus.PARSED;
            case PARSED -> to == DemoStatus.ANALYZED;
            case FAILED -> to == DemoStatus.QUEUED || to == DemoStatus.STORED;
            case ANALYZED -> false;
        };
    }

    public Long getId() {
        return id;
    }

    public Match getMatch() {
        return match;
    }

    public DemoStatus getStatus() {
        return status;
    }

    public String getStorageKey() {
        return storageKey;
    }

    public void setStorageKey(String storageKey) {
        this.storageKey = storageKey;
    }

    public String getError() {
        return error;
    }

    public Integer getTickRate() {
        return tickRate;
    }

    public void setTickRate(Integer tickRate) {
        this.tickRate = tickRate;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
