-- Accounts: the people who sign in to the site, and their sessions.
-- A user signs in with Steam (steam_id) or, later, with FACEIT (faceit_id); at least one of the two is always known. A
-- user whose FACEIT player has been found also has player_id, the row of that player in players (the one the site
-- shows on /players/{faceit id}); it stays NULL while no FACEIT player is linked. role: USER or ADMIN. nickname is the
-- FACEIT nickname once the player is linked, and until then "Steam " and the last six digits of the SteamID.
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  steam_id VARCHAR(32) UNIQUE,
  faceit_id VARCHAR(64) UNIQUE,
  player_id BIGINT REFERENCES players(id),
  nickname VARCHAR(64) NOT NULL,
  avatar_url TEXT,
  role VARCHAR(16) NOT NULL DEFAULT 'USER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CHECK (steam_id IS NOT NULL OR faceit_id IS NOT NULL));

-- One row per session. The browser holds a random token in a cookie; the table holds only the SHA-256 of it (as 64
-- lowercase hex digits), so a copy of the table cannot be used to sign in. A session ends at expires_at or when its row
-- is deleted (signing out), and the rows of a user go with the user.
CREATE TABLE user_sessions (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL);

CREATE INDEX idx_user_sessions_expires ON user_sessions (expires_at);
