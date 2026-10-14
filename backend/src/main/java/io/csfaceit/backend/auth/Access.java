package io.csfaceit.backend.auth;

import io.csfaceit.backend.common.api.ConflictException;
import io.csfaceit.backend.config.ApiKeyAuthFilter;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchTeam;
import io.csfaceit.backend.faceit.dto.FaceitRosterPlayer;
import java.util.Set;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * The one place where the rules of who may change what live. {@code SecurityConfig} only decides which requests a
 * session reaches at all; whether this session may bring the demo of this match, or order, retry or delete this clip,
 * is decided here and nowhere else. A controller asks {@link #current} who is acting and hands the {@link Actor} to its
 * service, which calls the rule that fits once it knows what the request is about.
 *
 * <p>The admin key and an administrator pass every rule. A {@code USER} acts only for the matches they played and for
 * their own player and clips:
 * <ul>
 *   <li>{@link #requireMatchMember}: the user's FACEIT player is in one of the rosters FACEIT gives for the match
 *   <li>{@link #requireMatchmakingMember}: for a matchmaking match, which FACEIT does not know, the user brought it in
 *       or is among the players of its analyzed demo
 *   <li>{@link #requireOwnPlayer}: the player something is ordered for is the user's own (their FACEIT player, or
 *       {@code steam:} and their SteamID)
 *   <li>{@link #requireClipOwner}: the clip was ordered by this user ({@code clips.requested_by})
 *   <li>{@link #requireDemoReplaceable} and {@link #requireDemoAwaitingAnalysis}: a demo that has been parsed is not
 *       replaced, and an analysis that has been done is not done again, by a user
 * </ul>
 * A user who has no FACEIT player linked is nobody's roster member and has no player of their own, which is said with a
 * code of its own ({@code FACEIT_NOT_LINKED}) so that a page can tell them what is missing.
 *
 * <p>A refusal is logged with the id of the user and the code, and nothing else: no SteamID, nickname or token.
 */
@Component
public class Access {

    public static final String FACEIT_NOT_LINKED = "FACEIT_NOT_LINKED";
    public static final String NOT_IN_MATCH = "NOT_IN_MATCH";
    public static final String NOT_YOUR_PLAYER = "NOT_YOUR_PLAYER";
    public static final String NOT_YOUR_CLIP = "NOT_YOUR_CLIP";
    public static final String DEMO_ALREADY_PARSED = "DEMO_ALREADY_PARSED";
    public static final String DEMO_ALREADY_ANALYZED = "DEMO_ALREADY_ANALYZED";

    private static final String KEY_AUTHORITY = "ROLE_" + ApiKeyAuthFilter.ROLE;

    /** The id of a player known only from demos is {@code steam:<SteamID>}. */
    private static final String STEAM_PLAYER_PREFIX = "steam:";

    private static final Logger log = LoggerFactory.getLogger(Access.class);

    /**
     * Who is making the request, from what the filters of {@code SecurityConfig} have authenticated it as: a session
     * (the principal is its {@link SignedInUser}, whose role is the effective one) or the admin key. The key's filter
     * comes first and the session's filter does not replace its identity, so a request with both is the key's.
     *
     * @throws AccessDeniedException the request is authenticated as neither, which the rules of {@code SecurityConfig}
     *         do not let through to a controller that asks; answered 403 {@code FORBIDDEN} like any other
     */
    public Actor current() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()) {
            if (authentication.getPrincipal() instanceof SignedInUser user) {
                return Actor.of(user);
            }
            for (GrantedAuthority authority : authentication.getAuthorities()) {
                if (KEY_AUTHORITY.equals(authority.getAuthority())) {
                    return Actor.key();
                }
            }
        }
        throw new AccessDeniedException("The request has neither the admin key nor a session");
    }

    /**
     * The id of the user whose session is reading, for what an answer says about the reader ({@code mine} of a clip):
     * {@code null} for a visitor who is not signed in and for the admin key, which is nobody. Unlike {@link #current}
     * it refuses nothing, because the reads are open.
     */
    public Long viewerId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()
                && authentication.getPrincipal() instanceof SignedInUser user) {
            return user.id();
        }
        return null;
    }

    /**
     * The actor played the match: their FACEIT player is in one of its rosters.
     *
     * @param match FACEIT's answer for the match
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_IN_MATCH}
     */
    public void requireMatchMember(Actor actor, FaceitMatch match) {
        requireMatchMember(actor, () -> match);
    }

    /**
     * Like {@link #requireMatchMember(Actor, FaceitMatch)} for a caller that would have to ask FACEIT for the match:
     * {@code match} is asked only when the answer is needed, so the key and an administrator cost no call, and a user
     * without a FACEIT player is refused before one is made. Whatever {@code match} throws (FACEIT does not know the
     * match, FACEIT cannot be asked) goes to the caller: a roster that cannot be read lets nobody in.
     */
    public void requireMatchMember(Actor actor, Supplier<FaceitMatch> match) {
        if (actor.unlimited()) {
            return;
        }
        String playerId = requireLinkedPlayer(actor);
        FaceitMatch found = match.get();
        if (found != null && found.teams() != null) {
            for (FaceitMatchTeam team : found.teams().values()) {
                if (team == null || team.roster() == null) {
                    continue;
                }
                for (FaceitRosterPlayer player : team.roster()) {
                    if (player != null && playerId.equals(player.playerId())) {
                        return;
                    }
                }
            }
        }
        throw refused(actor, NOT_IN_MATCH, "You did not play this match, so you cannot bring or analyze its demo");
    }

    /**
     * The actor played the matchmaking match ({@code mm-<id>}), which FACEIT knows nothing of: the user who brought it in
     * (its owner) always; once its demo has been analyzed, also a user whose SteamID is among the demo's players. Until
     * then the demo's players are not trusted (the wrong-demo check runs between parse and analysis), so only the owner
     * gets in. No FACEIT player is needed for any of it.
     *
     * @param ownerUserId {@code matches.owner_user_id}; {@code null} for a match nobody brought in
     * @param demoSteamIds the SteamIDs of the players of the match's analyzed demo, asked only when the owner rule does
     *        not let the actor in; empty until the demo is analyzed
     * @throws ForbiddenException {@code NOT_IN_MATCH}
     */
    public void requireMatchmakingMember(Actor actor, Long ownerUserId, Supplier<Set<String>> demoSteamIds) {
        if (actor.unlimited()) {
            return;
        }
        if (ownerUserId != null && ownerUserId.equals(actor.userId())) {
            return;
        }
        String steamId = actor.user().steamId();
        if (steamId != null && !steamId.isBlank() && demoSteamIds.get().contains(steamId)) {
            return;
        }
        throw refused(actor, NOT_IN_MATCH, "You did not play this match, so you cannot bring or analyze its demo");
    }

    /**
     * The player is the actor's own: the user's linked FACEIT player, or {@code steam:<SteamID>} with the user's own
     * SteamID, which is how a player known only from demos (a matchmaking player) is named.
     *
     * @param playerId the FACEIT id of the player something is asked for, or {@code steam:<SteamID>}
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED} or {@code NOT_YOUR_PLAYER}
     */
    public void requireOwnPlayer(Actor actor, String playerId) {
        if (actor.unlimited()) {
            return;
        }
        String steamId = actor.user().steamId();
        if (steamId != null && !steamId.isBlank() && (STEAM_PLAYER_PREFIX + steamId).equals(playerId)) {
            return;
        }
        if (!requireLinkedPlayer(actor).equals(playerId)) {
            throw refused(actor, NOT_YOUR_PLAYER, "You can order clips of your own player only");
        }
    }

    /**
     * The clip was ordered by the actor. A clip that nobody is recorded for (ordered with the admin key, or before
     * orders were recorded) is the key's and an administrator's alone.
     *
     * @param requestedBy {@code clips.requested_by} of the clip, read under the row's lock; {@code null} when it has
     *        none
     * @throws ForbiddenException {@code NOT_YOUR_CLIP}
     */
    public void requireClipOwner(Actor actor, Long requestedBy) {
        if (actor.unlimited()) {
            return;
        }
        if (requestedBy == null || !requestedBy.equals(actor.userId())) {
            throw refused(actor, NOT_YOUR_CLIP, "This clip was not ordered by you");
        }
    }

    /**
     * A file may take the place of the match's demo. A demo that has been parsed holds the statistics and the
     * highlights of all ten players, and a member of the roster must not replace them with another file; the key and
     * an administrator may, which is how a demo is parsed again on purpose.
     *
     * @param status the status of the match's demo, or {@code null} when the match has none
     * @throws ConflictException {@code DEMO_ALREADY_PARSED}
     */
    public void requireDemoReplaceable(Actor actor, DemoStatus status) {
        if (actor.unlimited()) {
            return;
        }
        if (status == DemoStatus.PARSED || status == DemoStatus.ANALYZED) {
            log.info("Refused user {}: {}", actor.userId(), DEMO_ALREADY_PARSED);
            throw new ConflictException(DEMO_ALREADY_PARSED,
                    "The demo of this match has already been parsed and cannot be uploaded again");
        }
    }

    /**
     * The analysis of a parsed demo may be asked for. A user asks for the analysis that is missing (the demo is
     * {@code PARSED}: the analysis failed or has not run); doing again an analysis that is there is the key's and an
     * administrator's. A demo in any other status is not this rule's concern: the caller answers for it as for anyone.
     *
     * @throws ConflictException {@code DEMO_ALREADY_ANALYZED}
     */
    public void requireDemoAwaitingAnalysis(Actor actor, DemoStatus status) {
        if (actor.unlimited()) {
            return;
        }
        if (status == DemoStatus.ANALYZED) {
            log.info("Refused user {}: {}", actor.userId(), DEMO_ALREADY_ANALYZED);
            throw new ConflictException(DEMO_ALREADY_ANALYZED,
                    "The demo of this match has already been analyzed");
        }
    }

    /**
     * The FACEIT id of the player the actor is linked to, for what is done for the actor's own matches (the sync of
     * their demos). Unlike the rules above it holds for an administrator too, and the admin key, which is nobody, has
     * no player.
     *
     * @throws ForbiddenException {@code FACEIT_NOT_LINKED}
     */
    public String requireLinkedPlayerId(Actor actor) {
        if (actor.user() == null) {
            throw refused(actor, FACEIT_NOT_LINKED, "The admin key has no FACEIT player of its own");
        }
        return requireLinkedPlayer(actor);
    }

    /** The FACEIT id of the user's player, which every rule about a match or a player starts from. */
    private static String requireLinkedPlayer(Actor actor) {
        String playerId = actor.user().playerId();
        if (playerId == null || playerId.isBlank()) {
            throw refused(actor, FACEIT_NOT_LINKED,
                    "No FACEIT player is linked to your account, so the site cannot tell which matches are yours");
        }
        return playerId;
    }

    private static ForbiddenException refused(Actor actor, String code, String message) {
        log.info("Refused user {}: {}", actor.userId(), code);
        return new ForbiddenException(code, message);
    }
}
