-- Montages: a third kind of clip, MONTAGE, whose segments the player picks himself in the editor, in an order of his
-- own. clips.kind has no CHECK (V4), so the new kind needs no change to it; a montage has neither a highlight nor a
-- unique index, every order is a clip of its own.
-- options holds what a montage is recorded with besides its segments, as JSON:
-- {"title": "...", "aspect": "16:9" or "9:16", "intro": false, "musicTrack": "..."}; title and musicTrack may be null.
-- NULL for a highlight clip and a compilation.
-- The segments of a montage carry one more field, {"startTick": 0, "endTick": 0, "slowMo": false}; a segment without
-- slowMo (every row before this migration) is played at normal speed.
ALTER TABLE clips ADD COLUMN options JSONB;
