package io.csfaceit.backend.match;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
}
