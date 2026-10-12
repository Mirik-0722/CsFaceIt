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
 * <p>FACEIT never decides whether someone can sign in. A SteamID that FACEIT does not know, a FACEIT that cannot be
 * reached, and a FACEIT player that another user is linked to already all leave the visitor signed in without a link:
 * the user keeps the nickname {@code Steam } and the last six digits of the SteamID, and the lookup is made again at
 * the next sign-in. A link that was made earlier is never taken away by a failed or empty lookup.
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

        FaceitPlayer profile = findFaceitPlayer(user, steamId);
        if (profile != null) {
            Player player = players.upsert(profile);
            user = persistence.linkFaceit(user.getId(), profile, player.getId());
        }
        log.info("User {} signed in with Steam ({})", user.getId(),
                user.getFaceitId() == null ? "no FACEIT player linked" : "FACEIT player linked");
        return user;
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

    /** The FACEIT player of the SteamID, or {@code null} when there is none to link or FACEIT cannot say. */
    private FaceitPlayer findFaceitPlayer(User user, String steamId) {
        try {
            FaceitPlayer found = faceit.findPlayerBySteamId(steamId);
            if (isBlank(found.playerId()) || isBlank(found.nickname())) {
                log.warn("FACEIT answered without an id or a nickname for the player of user {}", user.getId());
                return null;
            }
            return found;
        } catch (FaceitNotFoundException e) {
            log.info("FACEIT has no CS2 player for the Steam account of user {}", user.getId());
            return null;
        } catch (FaceitUnavailableException e) {
            log.warn("FACEIT could not be asked about user {}: {}", user.getId(), e.getMessage());
            return null;
        } catch (RestClientException e) {
            log.warn("FACEIT gave an unusable answer about user {} ({})", user.getId(), e.getClass().getSimpleName());
            return null;
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
