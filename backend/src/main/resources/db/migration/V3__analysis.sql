-- Analysis: two more facts of the demo parser (the roster of every round, the tick a round was decided) and the
-- per-match statistics of a player that are computed from the facts of a demo.

-- Written by the demo parser, like the fact tables of V2: who played a round, and on which side (CT or T).
CREATE TABLE round_players (
  match_id BIGINT NOT NULL REFERENCES matches(id),
  round_number INTEGER NOT NULL,
  player_id BIGINT NOT NULL REFERENCES players(id),
  side VARCHAR(2) NOT NULL,
  PRIMARY KEY (match_id, round_number, player_id));

-- The tick the round was decided at; end_tick also covers the seconds after it. NULL for a round that was parsed
-- before this migration.
ALTER TABLE rounds ADD COLUMN decided_tick INTEGER;

-- rounds_played, entry_kills, trade_kills, clutch_attempts and clutch_wins come from the analysis of the demo:
-- rounds_played IS NULL means the row was not analyzed from a demo. won is whether the player's team won the match.
ALTER TABLE player_match_stats
  ADD COLUMN rounds_played INTEGER,
  ADD COLUMN entry_kills INTEGER,
  ADD COLUMN trade_kills INTEGER,
  ADD COLUMN clutch_attempts INTEGER,
  ADD COLUMN clutch_wins INTEGER,
  ADD COLUMN won BOOLEAN;

CREATE INDEX idx_pms_match ON player_match_stats (match_id);
CREATE INDEX idx_highlights_match ON highlights (match_id);
