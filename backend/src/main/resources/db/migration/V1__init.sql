CREATE TABLE players (
  id BIGSERIAL PRIMARY KEY,
  faceit_id VARCHAR(64) NOT NULL UNIQUE,
  nickname  VARCHAR(64) NOT NULL,
  elo INTEGER, level INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE matches (
  id BIGSERIAL PRIMARY KEY,
  faceit_match_id VARCHAR(64) NOT NULL UNIQUE,
  map_name VARCHAR(64), started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ);
CREATE TABLE player_match_stats (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(id),
  match_id  BIGINT NOT NULL REFERENCES matches(id),
  kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0, headshots INTEGER NOT NULL DEFAULT 0,
  adr NUMERIC(6,2), kast NUMERIC(5,2), rating NUMERIC(5,2),
  UNIQUE (player_id, match_id));
CREATE TABLE highlights (
  id BIGSERIAL PRIMARY KEY,
  match_id  BIGINT NOT NULL REFERENCES matches(id),
  player_id BIGINT NOT NULL REFERENCES players(id),
  type VARCHAR(32) NOT NULL, round_number INTEGER NOT NULL,
  tick_start INTEGER NOT NULL, tick_end INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_highlights_player_type ON highlights (player_id, type);
CREATE INDEX idx_pms_player ON player_match_stats (player_id);
