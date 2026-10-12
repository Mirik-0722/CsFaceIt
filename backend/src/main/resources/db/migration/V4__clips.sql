-- Video clips: the queue of clips that a recorder cuts from the stored demo of a match, and the recorders that work on it.
-- kind: HIGHLIGHT or COMPILATION. status: QUEUED, RECORDING, ENCODING, UPLOADING, DONE or FAILED (error is set when
-- FAILED, and keeps the reason of the last failed attempt while the clip waits to be recorded again).
-- A HIGHLIGHT clip is tied to its highlight by the natural key (match_id, player_id, highlight_type, round_number,
-- tick_start), not by highlights.id: an analysis replaces the highlight rows, so their ids do not last.
-- segments is the JSON array of the stretches of the demo the video is made of: [{"startTick": 0, "endTick": 0}, ...].
CREATE TABLE clips (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id),
  player_id BIGINT NOT NULL REFERENCES players(id),
  kind VARCHAR(16) NOT NULL,
  highlight_type VARCHAR(32),
  round_number INTEGER,
  tick_start INTEGER,
  tick_end INTEGER,
  quality VARCHAR(8) NOT NULL,
  fps INTEGER NOT NULL,
  segments JSONB NOT NULL,
  status VARCHAR(16) NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  claimed_by VARCHAR(64),
  claimed_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  video_key VARCHAR(255),
  thumbnail_key VARCHAR(255),
  duration_ms INTEGER,
  size_bytes BIGINT,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ);

CREATE INDEX idx_clips_queue ON clips (created_at, id) WHERE status = 'QUEUED';
CREATE INDEX idx_clips_match ON clips (match_id);
CREATE INDEX idx_clips_player ON clips (player_id, created_at DESC);

-- One clip that is not FAILED per highlight and quality, and one compilation per player, match and quality.
CREATE UNIQUE INDEX uq_clips_highlight ON clips (match_id, player_id, highlight_type, round_number, tick_start, quality)
  WHERE kind = 'HIGHLIGHT' AND status <> 'FAILED';
CREATE UNIQUE INDEX uq_clips_compilation ON clips (match_id, player_id, quality)
  WHERE kind = 'COMPILATION' AND status <> 'FAILED';

-- The recorders that have called the worker API; state is IDLE or WORKING.
CREATE TABLE clip_workers (
  name VARCHAR(64) PRIMARY KEY,
  version VARCHAR(32),
  mode VARCHAR(16),
  state VARCHAR(16) NOT NULL,
  current_clip_id BIGINT,
  last_seen_at TIMESTAMPTZ NOT NULL);
