package io.csfaceit.backend.analysis.highlight;

import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.player.Player;
import jakarta.persistence.Column;
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
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * One row of {@code highlights}: a moment of a match worth a clip, found by the analysis of its demo. {@code tickStart}
 * and {@code tickEnd} are the ticks of the clip, the event with its lead-in and tail, and always lie inside the round
 * (see {@code AnalysisPersistence}). The rows of a match are replaced as a whole by every analysis of its demo, never
 * changed one by one.
 */
@Entity
@Table(name = "highlights")
public class Highlight {

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
    @Column(name = "type", nullable = false, length = 32)
    private HighlightType type;

    @Column(name = "round_number", nullable = false)
    private int roundNumber;

    @Column(name = "tick_start", nullable = false)
    private int tickStart;

    @Column(name = "tick_end", nullable = false)
    private int tickEnd;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Highlight() {
    }

    public Highlight(Match match, Player player, HighlightType type, int roundNumber, int tickStart, int tickEnd) {
        this.match = match;
        this.player = player;
        this.type = type;
        this.roundNumber = roundNumber;
        this.tickStart = tickStart;
        this.tickEnd = tickEnd;
    }

    @PrePersist
    void onCreate() {
        this.createdAt = Instant.now();
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

    public HighlightType getType() {
        return type;
    }

    public int getRoundNumber() {
        return roundNumber;
    }

    public int getTickStart() {
        return tickStart;
    }

    public int getTickEnd() {
        return tickEnd;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
