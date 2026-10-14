-- A person's list of matchmaking matches starts from the users who are that person: the user linked to their player
-- row, or the user with their SteamID (users.steam_id has its unique index). This one serves the link to the player row,
-- so that each list finds those users by index instead of reading every user; only linked users are in it.
CREATE INDEX idx_users_player ON users (player_id) WHERE player_id IS NOT NULL;
