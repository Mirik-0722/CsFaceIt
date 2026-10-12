package io.csfaceit.backend.auth;

import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import io.csfaceit.backend.player.PlayerRepository;
import java.time.Instant;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The database writes behind a sign-in. It is a bean of its own so that the transaction proxy applies, as with
 * {@code ClipPersistence}: {@link SignInService} asks Steam and FACEIT with no transaction open and calls in here for
 * each short step. Nothing in here calls out of the process.
 *
 * <p>When two first sign-ins of the same Steam account run at once, both find no row and both insert; PostgreSQL fails
 * the second insert with a unique violation, which aborts that transaction and surfaces as a
 * {@link org.springframework.dao.DataIntegrityViolationException}. Nothing is recovered in here: the caller repeats the
 * step, and finds the other request's row.
 */
@Component
public class UserPersistence {

    private static final Logger log = LoggerFactory.getLogger(UserPersistence.class);

    private final UserRepository users;
    private final PlayerRepository players;

    public UserPersistence(UserRepository users, PlayerRepository players) {
        this.users = users;
        this.players = players;
    }

    /**
     * Records a sign-in with the Steam account: the user is created when there is none, and otherwise gets the role the
     * settings give the account now and the time of this sign-in. A new user is not linked to a FACEIT player.
     */
    @Transactional
    public User signIn(String steamId, UserRole role, Instant now) {
        User user = users.findBySteamId(steamId).orElse(null);
        if (user == null) {
            return users.saveAndFlush(User.withSteam(steamId, role, now));
        }
        user.signedIn(role, now);
        return users.save(user);
    }

    /**
     * Links the user to the FACEIT player found for their SteamID: the id, the nickname and the avatar of the player
     * become the user's, and the user points at the row of the player ({@code playerRowId}, which the caller has just
     * made sure exists). A FACEIT player is linked to one user at most, so when another user holds this one the user
     * stays as they were and this is logged: that happens when a FACEIT account has moved to another Steam account.
     */
    @Transactional
    public User linkFaceit(long userId, FaceitPlayer profile, long playerRowId) {
        User user = users.findById(userId).orElseThrow(() -> new IllegalStateException("User " + userId + " is gone"));
        Optional<User> holder = users.findByFaceitId(profile.playerId());
        if (holder.isPresent() && !holder.get().getId().equals(userId)) {
            log.warn("The FACEIT player found for user {} is linked to user {} already; user {} stays unlinked", userId,
                    holder.get().getId(), userId);
            return user;
        }
        user.linkFaceit(profile.playerId(), profile.nickname(), blankToNull(profile.avatar()),
                players.getReferenceById(playerRowId));
        return users.save(user);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
