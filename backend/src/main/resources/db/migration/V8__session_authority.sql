-- The schema for letting a session act (plan 6b): what a signed-in visitor may do is limited by who they are and how much
-- they have done, so the clips need an owner and the actions need counting. This migration only creates the places; the
-- tasks that use them come after it.

-- Ending every session of a user looks the sessions up by user; V5 has an index on expires_at only.
CREATE INDEX idx_user_sessions_user ON user_sessions (user_id);

-- Who ordered a clip. NULL for a clip ordered with the admin key, which has no user, and for the clips that existed before
-- this column did; it is also set to NULL when the user is deleted, so that the clip outlives the person.
ALTER TABLE clips ADD COLUMN requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

-- One row for each thing a user did that counts against a limit: kind says what (a demo upload, a demo import, a clip
-- order), created_at when. A limit is "so many rows of a kind within a window", read from the index below. The rows of a
-- user go with the user.
CREATE TABLE user_actions (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_actions_user_kind_time ON user_actions (user_id, kind, created_at);

-- When the user last used the site (a session was seen), and when their matches were last fetched from FACEIT. NULL until
-- the first time either happens.
ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN faceit_synced_at TIMESTAMPTZ;
