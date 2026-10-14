package io.csfaceit.backend.demo;

import io.csfaceit.backend.auth.Access;
import io.csfaceit.backend.auth.Actor;
import io.csfaceit.backend.demo.FaceitSyncService.SyncResult;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /api/v1/matches/sync}: the page of a player's matches asks, when it opens, for the demos of the matches
 * that have none to be brought (see {@link FaceitSyncService}). It is for a session whose user is linked to a FACEIT
 * player (403 {@code FACEIT_NOT_LINKED} otherwise, also for the admin key alone, which has no player), it is a write and
 * so goes through the cross-site rule of every session {@code POST}, and it counts against no limit. The answer is 202
 * with {@code {"enabled", "queued"}}: {@code enabled} is false while the site has no access to FACEIT's Downloads API.
 */
@RestController
@RequestMapping("/api/v1/matches")
public class SyncController {

    private final FaceitSyncService sync;
    private final Access access;

    public SyncController(FaceitSyncService sync, Access access) {
        this.sync = sync;
        this.access = access;
    }

    @PostMapping("/sync")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public SyncResult sync() {
        Actor actor = access.current();
        String playerId = access.requireLinkedPlayerId(actor);
        return sync.syncNow(actor.userId(), playerId);
    }
}
