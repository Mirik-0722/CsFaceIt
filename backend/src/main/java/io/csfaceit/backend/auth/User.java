package io.csfaceit.backend.auth;

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
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * A person who has signed in. Today that is always with Steam, so {@code steamId} is set; {@code faceitId}, the id of
 * the person's FACEIT player, is set once the sign-in has found that player, and {@code player} then points at the
 * site's row for it. Until then the nickname is the placeholder from {@link #placeholderNickname}.
 */
@Entity
@Table(name = "users")
public class User {

    /** The part of a SteamID that is shown in the placeholder nickname. */
    private static final int PLACEHOLDER_DIGITS = 6;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "steam_id", length = 32)
    private String steamId;

    @Column(name = "faceit_id", length = 64)
    private String faceitId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "player_id")
    private Player player;

    @Column(name = "nickname", nullable = false, length = 64)
    private String nickname;

    @Column(name = "avatar_url", columnDefinition = "TEXT")
    private String avatarUrl;

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false, length = 16)
    private UserRole role;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    protected User() {
    }

    private User(String steamId, String nickname, UserRole role, Instant now) {
        this.steamId = steamId;
        this.nickname = nickname;
        this.role = role;
        this.createdAt = now;
        this.lastLoginAt = now;
    }

    /** A user who signs in with Steam for the first time: not linked to a FACEIT player yet. */
    public static User withSteam(String steamId, UserRole role, Instant now) {
        return new User(steamId, placeholderNickname(steamId), role, now);
    }

    /** {@code Steam } and the last six digits of the SteamID, which is what a user is called until FACEIT names them. */
    public static String placeholderNickname(String steamId) {
        int from = Math.max(0, steamId.length() - PLACEHOLDER_DIGITS);
        return "Steam " + steamId.substring(from);
    }

    /** A sign-in: the role is the one the settings give the SteamID now, and the time is the sign-in's. */
    public void signedIn(UserRole role, Instant now) {
        this.role = role;
        this.lastLoginAt = now;
    }

    /** Links the user to the FACEIT player found for their SteamID; the user takes the player's nickname and avatar. */
    public void linkFaceit(String faceitId, String nickname, String avatarUrl, Player player) {
        this.faceitId = faceitId;
        this.nickname = nickname;
        this.avatarUrl = avatarUrl;
        this.player = player;
    }

    public Long getId() {
        return id;
    }

    public String getSteamId() {
        return steamId;
    }

    public String getFaceitId() {
        return faceitId;
    }

    public Player getPlayer() {
        return player;
    }

    public String getNickname() {
        return nickname;
    }

    public String getAvatarUrl() {
        return avatarUrl;
    }

    public UserRole getRole() {
        return role;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getLastLoginAt() {
        return lastLoginAt;
    }
}
