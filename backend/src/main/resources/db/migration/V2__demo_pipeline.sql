-- Demo pipeline: the Steam id of a player, the demo of a match and the facts the demo parser extracts from it.
ALTER TABLE players ADD COLUMN steam_id VARCHAR(32);
CREATE UNIQUE INDEX uq_players_steam_id ON players (steam_id) WHERE steam_id IS NOT NULL;

-- One demo per match. status: QUEUED, STORED, PARSED, ANALYZED or FAILED (error is set when FAILED).
CREATE TABLE demos (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT NOT NULL UNIQUE REFERENCES matches(id),
  status VARCHAR(16) NOT NULL,
  storage_key VARCHAR(255),
  error TEXT,
  tick_rate INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- The tables below are written by the demo parser; they hold facts only.
CREATE TABLE rounds (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  round_number INTEGER NOT NULL,
  winner_side VARCHAR(2),
  win_reason VARCHAR(32),
  start_tick INTEGER NOT NULL,
  end_tick INTEGER NOT NULL,
  bomb_planted_tick INTEGER,
  bomb_defused_tick INTEGER,
  defuser_id BIGINT REFERENCES players(id),
  UNIQUE (match_id, round_number));

-- killer_id is NULL for a death caused by the world or the bomb.
CREATE TABLE kills (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  round_number INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  killer_id BIGINT REFERENCES players(id),
  victim_id BIGINT NOT NULL REFERENCES players(id),
  assister_id BIGINT REFERENCES players(id),
  weapon VARCHAR(64) NOT NULL,
  headshot BOOLEAN NOT NULL DEFAULT false,
  wallbang BOOLEAN NOT NULL DEFAULT false,
  noscope BOOLEAN NOT NULL DEFAULT false,
  thrusmoke BOOLEAN NOT NULL DEFAULT false,
  attacker_blind BOOLEAN NOT NULL DEFAULT false,
  killer_side VARCHAR(2),
  victim_side VARCHAR(2),
  killer_x REAL, killer_y REAL,
  victim_x REAL, victim_y REAL);

CREATE TABLE damages (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  round_number INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  attacker_id BIGINT REFERENCES players(id),
  victim_id BIGINT NOT NULL REFERENCES players(id),
  weapon VARCHAR(64),
  damage_health INTEGER NOT NULL,
  damage_armor INTEGER NOT NULL DEFAULT 0);

-- kind is kill, death or movement; side is CT or T; a bin is a 64-unit square of the map.
CREATE TABLE heat_bins (
  match_id BIGINT NOT NULL REFERENCES matches(id),
  player_id BIGINT NOT NULL REFERENCES players(id),
  kind VARCHAR(16) NOT NULL,
  side VARCHAR(2) NOT NULL,
  bin_x INTEGER NOT NULL,
  bin_y INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id, kind, side, bin_x, bin_y));

CREATE INDEX idx_kills_match_round ON kills (match_id, round_number);
CREATE INDEX idx_kills_killer ON kills (killer_id);
CREATE INDEX idx_kills_victim ON kills (victim_id);
CREATE INDEX idx_damages_match_round ON damages (match_id, round_number);
