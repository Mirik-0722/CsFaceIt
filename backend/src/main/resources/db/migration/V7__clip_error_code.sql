-- A reason a page can translate: clips.error stays the sentence (the recorder's own words, or the backend's English
-- sentence), error_code is a short upper-case code for the reasons the backend itself finds and words, the codes of
-- ClipErrorCode (RECORDER_STOPPED, NO_REASON, DEMO_GONE and STEAM_ID_UNKNOWN). NULL for a reason the recorder reported,
-- which is free text. It is set together with error and cleared whenever error is.
ALTER TABLE clips ADD COLUMN error_code VARCHAR(32);
