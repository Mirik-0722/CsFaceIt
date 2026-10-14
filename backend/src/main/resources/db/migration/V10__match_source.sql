-- CS2 matchmaking as a source of matches (plan 6c). A match no longer has to be FACEIT's: a Valve matchmaking match
-- exists from its demo alone, under the public id mm-<Valve match id> in the same faceit_match_id column, which keeps its
-- name because it stays the public id of every match.

-- Where the match comes from: FACEIT (every match before this migration) or MATCHMAKING. A MATCHMAKING match is never
-- asked of FACEIT; its map, teams, score and statistics are read from its analysed demo.
ALTER TABLE matches ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'FACEIT';

-- The match sharing code the match was found by (CSGO-xxxxx-…), and the user whose matchmaking games brought it in: the
-- owner may bring and see the match before its demo is parsed, and the owner's SteamID has to be among the demo's
-- players. Both NULL for a FACEIT match. The match outlives a deleted owner.
ALTER TABLE matches ADD COLUMN share_code VARCHAR(64);
ALTER TABLE matches ADD COLUMN owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

-- One row for each user who linked their CS2 matchmaking history: the authentication code (AES-256-GCM with a random
-- nonce, never readable from here), the last match sharing code known for the account, and where the walk along the
-- chain of codes stands. state: ACTIVE, BAD_AUTH_CODE or BAD_SHARE_CODE. The link goes with the user.
CREATE TABLE cs2_links (
    user_id         BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    auth_code       BYTEA       NOT NULL,
    last_share_code VARCHAR(64) NOT NULL,
    state           VARCHAR(16) NOT NULL,
    failures        INT         NOT NULL DEFAULT 0,
    next_check_at   TIMESTAMPTZ,
    checked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
