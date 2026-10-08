package io.csfaceit.backend.match;

import io.csfaceit.backend.player.Player;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.math.BigDecimal;

@Entity
@Table(
        name = "player_match_stats",
        uniqueConstraints = @UniqueConstraint(columnNames = {"player_id", "match_id"}))
public class PlayerMatchStats {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "player_id", nullable = false)
    private Player player;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "match_id", nullable = false)
    private Match match;

    @Column(name = "kills", nullable = false)
    private int kills;

    @Column(name = "deaths", nullable = false)
    private int deaths;

    @Column(name = "assists", nullable = false)
    private int assists;

    @Column(name = "headshots", nullable = false)
    private int headshots;

    @Column(name = "adr", precision = 6, scale = 2)
    private BigDecimal adr;

    @Column(name = "kast", precision = 5, scale = 2)
    private BigDecimal kast;

    @Column(name = "rating", precision = 5, scale = 2)
    private BigDecimal rating;

    protected PlayerMatchStats() {
    }

    public PlayerMatchStats(Player player, Match match) {
        this.player = player;
        this.match = match;
    }

    public Long getId() {
        return id;
    }

    public Player getPlayer() {
        return player;
    }

    public Match getMatch() {
        return match;
    }

    public int getKills() {
        return kills;
    }

    public void setKills(int kills) {
        this.kills = kills;
    }

    public int getDeaths() {
        return deaths;
    }

    public void setDeaths(int deaths) {
        this.deaths = deaths;
    }

    public int getAssists() {
        return assists;
    }

    public void setAssists(int assists) {
        this.assists = assists;
    }

    public int getHeadshots() {
        return headshots;
    }

    public void setHeadshots(int headshots) {
        this.headshots = headshots;
    }

    public BigDecimal getAdr() {
        return adr;
    }

    public void setAdr(BigDecimal adr) {
        this.adr = adr;
    }

    public BigDecimal getKast() {
        return kast;
    }

    public void setKast(BigDecimal kast) {
        this.kast = kast;
    }

    public BigDecimal getRating() {
        return rating;
    }

    public void setRating(BigDecimal rating) {
        this.rating = rating;
    }
}
