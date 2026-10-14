package io.csfaceit.backend.auth;

import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.FaceitNotFoundException;
import io.csfaceit.backend.faceit.FaceitUnavailableException;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import io.csfaceit.backend.player.Player;
import io.csfaceit.backend.player.PlayerService;
import java.time.Clock;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;

/**
 * What happens to a visitor whose Steam account has been confirmed: they become a user of the site (a new one, or the
 * one they already were), and the site looks for their FACEIT player.
 *
 * <p>Like {@code ClipService} it opens no transaction itself. FACEIT is asked with none open, and the database steps
 * are the short transactions of {@link UserPersistence} (and of {@link PlayerService#upsert}, which makes sure the
 * site has a row for the player).
 *
 * <p>FACEIT never decides whether someone can sign in. The visitor is signed in whatever FACEIT says, and FACEIT only
 * decides what the user is linked to. Its answers are told apart:
 *
 * <ul>
 *   <li>a player is found: the user is linked to it, and when another user held the player (the FACEIT account moved to
 *       another Steam account) that user is unlinked first, so the latest proof wins
 *   <li>FACEIT says for certain that there is none (a 404 for the SteamID): a link the user had is taken away, because
 *       it is no longer true
 *   <li>FACEIT cannot say (it is down, gave an unusable answer or one with no id or nickname): nothing changes, a link
 *       that exists stays and one that does not is looked for again at the next sign-in
 *   <li>two sign-ins link the same player at the same moment and one of the writes fails on the unique index: the step
 *       is repeated once, and if it fails again the user stays as they were
 * </ul>
 *
 * A user without a link keeps the nickname {@code Steam } and the last six digits of the SteamID.
 */
@Service
public class SignInService {

    private static final Logger log = LoggerFactory.getLogger(SignInService.class);

    private final UserPersistence persistence;
    private final FaceitGateway faceit;
    private final PlayerService players;
    private final AuthProperties properties;
    private final Clock clock;

    public SignInService(UserPersistence persistence, FaceitGateway faceit, PlayerService players,
                         AuthProperties properties, Clock clock) {
        this.persistence = persistence;
        this.faceit = faceit;
        this.players = players;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Signs the Steam account in and returns its user, linked to the FACEIT player of the account when there is one.
     * The role is {@code ADMIN} for a SteamID in {@code auth.admin-steam-ids} and {@code USER} for any other, decided
     * again at every sign-in.
     */
    public User signInWithSteam(String steamId) {
        UserRole role = properties.adminSteamIds().contains(steamId) ? UserRole.ADMIN : UserRole.USER;
        User user = recordSignIn(steamId, role, clock.instant());

        user = updateFaceitLink(user, steamId);
        if (user.getPlayer() != null) {
            giveSteamIdToPlayer(user, steamId);
        }
        log.info("User {} signed in with Steam ({})", user.getId(),
                user.getFaceitId() == null ? "no FACEIT player linked" : "FACEIT player linked");
        return user;
    }

    /**
     * Writes the visitor's SteamID onto their linked FACEIT player, so that the parser files their matchmaking kills
     * under that one player and not under a second row {@code steam:<SteamID>}: one person, one row. The SteamID moves
     * when another row had it (see {@link PlayerService#claimSteamId}). A write that loses a race is left for the next
     * sign-in; it never stops this one.
     */
    private void giveSteamIdToPlayer(User user, String steamId) {
        try {
            if (players.claimSteamId(user.getPlayer().getId(), steamId)) {
                log.info("Gave the SteamID of user {} to their FACEIT player", user.getId());
            }
        } catch (DataIntegrityViolationException e) {
            log.warn("Could not give the SteamID of user {} to their FACEIT player ({}); trying again at the next "
                    + "sign-in", user.getId(), e.getClass().getSimpleName());
        }
    }

    /** The write of the sign-in; repeated once if it loses the race to create the same user. */
    private User recordSignIn(String steamId, UserRole role, Instant now) {
        try {
            return persistence.signIn(steamId, role, now);
        } catch (DataIntegrityViolationException e) {
            log.info("Lost a race to create the user of a Steam account, retrying once");
            return persistence.signIn(steamId, role, now);
        }
    }

    /**
     * Brings the user's link to a FACEIT player in line with what FACEIT says of the SteamID, and returns the user as
     * they are afterwards. Only a definite "there is no such player" takes a link away.
     */
    private User updateFaceitLink(User user, String steamId) {
        FaceitPlayer found;
        try {
            found = faceit.findPlayerBySteamId(steamId);
        } catch (FaceitNotFoundException e) {
            log.info("FACEIT has no CS2 player for the Steam account of user {}", user.getId());
            return persistence.unlinkFaceit(user.getId());
        } catch (FaceitUnavailableException e) {
            log.warn("FACEIT could not be asked about user {}: {}", user.getId(), e.getMessage());
            return user;
        } catch (RestClientException e) {
            log.warn("FACEIT gave an unusable answer about user {} ({})", user.getId(), e.getClass().getSimpleName());
            return user;
        }
        if (isBlank(found.playerId()) || isBlank(found.nickname())) {
            // An answer that names no player says nothing about whether there is one, so it changes nothing.
            log.warn("FACEIT answered without an id or a nickname for the player of user {}", user.getId());
            return user;
        }
        return link(user, found);
    }

    /**
     * Links the user to the player, repeating the step once if it loses a race to link that player (two sign-ins that
     * take it at the same moment: the unique index fails one of the writes). If the repeat fails as well the user stays
     * as they were, signed in and not linked, and the next sign-in tries again.
     */
    private User link(User user, FaceitPlayer profile) {
        Player player = players.upsert(profile);
        try {
            return persistence.linkFaceit(user.getId(), profile, player.getId());
        } catch (DataIntegrityViolationException e) {
            log.info("Lost a race to link the FACEIT player of user {}, retrying once", user.getId());
        }
        try {
            return persistence.linkFaceit(user.getId(), profile, player.getId());
        } catch (DataIntegrityViolationException e) {
            log.warn("The FACEIT player could not be linked to user {} twice in a row; the user stays as they were",
                    user.getId());
            return user;
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
