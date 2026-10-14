package io.csfaceit.backend.match;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "matches")
public class Match {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "faceit_match_id", nullable = false, unique = true, length = 64)
    private String faceitMatchId;

    @Column(name = "map_name", length = 64)
    private String mapName;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    /** Where the match comes from; every match written through this constructor is FACEIT's. */
    @Enumerated(EnumType.STRING)
    @Column(name = "source", nullable = false, length = 16)
    private MatchSource source = MatchSource.FACEIT;

    /** The match sharing code a matchmaking match was found by; {@code null} for a FACEIT match. */
    @Column(name = "share_code", length = 64)
    private String shareCode;

    /** The user whose matchmaking games brought the match in ({@code users.id}); {@code null} for a FACEIT match. */
    @Column(name = "owner_user_id")
    private Long ownerUserId;

    protected Match() {
    }

    public Match(String faceitMatchId, String mapName, Instant startedAt, Instant finishedAt) {
        this.faceitMatchId = faceitMatchId;
        this.mapName = mapName;
        this.startedAt = startedAt;
        this.finishedAt = finishedAt;
    }

    public Long getId() {
        return id;
    }

    public String getFaceitMatchId() {
        return faceitMatchId;
    }

    public String getMapName() {
        return mapName;
    }

    public void setMapName(String mapName) {
        this.mapName = mapName;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public void setFinishedAt(Instant finishedAt) {
        this.finishedAt = finishedAt;
    }

    public MatchSource getSource() {
        return source;
    }

    public String getShareCode() {
        return shareCode;
    }

    public Long getOwnerUserId() {
        return ownerUserId;
    }
}
