package io.csfaceit.backend.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import java.time.Instant;
import org.springframework.data.domain.Persistable;

/**
 * One session of a user. Its key is the SHA-256 of the token the browser holds in its cookie, never the token itself
 * (see {@link SessionService}), and it ends at {@code expiresAt} or when the row is deleted.
 *
 * <p>The key is assigned and not generated, so Spring Data would take every session for an existing row and merge it,
 * which reads the row first and, were a key ever to repeat, would overwrite the session that holds it. A session made
 * here says that it is new ({@link Persistable}), so that saving it is an insert, and a repeated key is an error.
 */
@Entity
@Table(name = "user_sessions")
public class UserSession implements Persistable<String> {

    @Id
    @Column(name = "token_hash", length = 64)
    private String tokenHash;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    /** True until the row has been written or read; not a column. */
    @Transient
    private boolean fresh = true;

    protected UserSession() {
    }

    public UserSession(String tokenHash, User user, Instant createdAt, Instant expiresAt) {
        this.tokenHash = tokenHash;
        this.user = user;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    @Override
    public String getId() {
        return tokenHash;
    }

    @Override
    public boolean isNew() {
        return fresh;
    }

    @PostPersist
    @PostLoad
    void markNotNew() {
        this.fresh = false;
    }

    public String getTokenHash() {
        return tokenHash;
    }

    public User getUser() {
        return user;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }
}
