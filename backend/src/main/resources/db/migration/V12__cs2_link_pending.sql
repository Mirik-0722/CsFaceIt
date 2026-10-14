-- The match sharing code of a CS2 link whose match is being brought (cs2/Cs2ChainJob): the code the player gave when they
-- linked, then each new code the walk along the chain finds, until the bridge to the game coordinator has answered for
-- it. NULL when there is none. It is kept apart from last_share_code, which is where the walk goes on from, so that a
-- replay that is not ready yet is asked for again later without losing the place in the chain.
ALTER TABLE cs2_links ADD COLUMN pending_share_code VARCHAR(64);
