-- The frame rate of a clip is chosen with its order (60, 120 or 240 fps, clip/ClipFps), like its quality. clips.fps has
-- been there since V4, filled from the one setting clip.fps (60) when a clip was ordered, so every existing row already
-- holds 60; the column only gains a default, for a row written without it.
ALTER TABLE clips ALTER COLUMN fps SET DEFAULT 60;

-- A clip at another frame rate is another clip: the same highlight, or the same player's compilation in a match, may now
-- stand once per quality and frame rate. The indexes of V4 are replaced by the same ones with fps in their key.
DROP INDEX uq_clips_highlight;
CREATE UNIQUE INDEX uq_clips_highlight ON clips (match_id, player_id, highlight_type, round_number, tick_start, quality,
  fps) WHERE kind = 'HIGHLIGHT' AND status <> 'FAILED';
DROP INDEX uq_clips_compilation;
CREATE UNIQUE INDEX uq_clips_compilation ON clips (match_id, player_id, quality, fps)
  WHERE kind = 'COMPILATION' AND status <> 'FAILED';
