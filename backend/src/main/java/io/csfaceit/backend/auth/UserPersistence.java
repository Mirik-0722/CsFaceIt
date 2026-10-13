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
 * step, and finds the other request's row. The link to a FACEIT player is the same: two sign-ins that take the same
 * player at once fail one write on the unique index of {@code users.faceit_id}, and the caller repeats that step too.
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
     * made sure exists). A FACEIT player is linked to one user at most, and the latest proof wins: FACEIT has just said
     * that this player belongs to the Steam account that signed in, so when another user holds it (the FACEIT account
     * moved to another Steam account) that user is unlinked first, in the same transaction and flushed before the new
     * link is written, because the unique index on {@code faceit_id} would refuse the two rows holding one id for as
     * long as it takes to write the second.
     *
     * <p>Two sign-ins that link the same player at the same moment can still both pass the check above; the index
     * fails the second write, which surfaces as a {@link org.springframework.dao.DataIntegrityViolationException} for
     * the caller to repeat (the write is flushed here for that reason, so that the failure is not left to the commit).
     */
    @Transactional
    public User linkFaceit(long userId, FaceitPlayer profile, long playerRowId) {
        User user = users.findById(userId).orElseThrow(() -> new IllegalStateException("User " + userId + " is gone"));
        Optional<User> holder = users.findByFaceitId(profile.playerId());
        if (holder.isPresent() && !holder.get().getId().equals(userId)) {
            User previous = holder.get();
            if (previous.unlinkFaceit()) {
                log.warn("FACEIT says the player of user {} belongs to the Steam account of user {}: user {} is "
                        + "unlinked and user {} is linked", previous.getId(), userId, previous.getId(), userId);
                users.saveAndFlush(previous);
            }
        }
        user.linkFaceit(profile.playerId(), profile.nickname(), blankToNull(profile.avatar()),
                players.getReferenceById(playerRowId));
        return users.saveAndFlush(user);
    }

    /**
     * Takes the FACEIT player away from the user, when they have one: FACEIT has said for certain that their Steam
     * account has no player, so what the site remembers of an earlier answer is no longer true. The user is the one a
     * Steam sign-in makes (see {@link User#unlinkFaceit}). A user with no link is left alone.
     */
    @Transactional
    public User unlinkFaceit(long userId) {
        User user = users.findById(userId).orElseThrow(() -> new IllegalStateException("User " + userId + " is gone"));
        if (!user.unlinkFaceit()) {
            return user;
        }
        log.info("FACEIT has no player for the Steam account of user {} any more: the user is unlinked", userId);
        return users.saveAndFlush(user);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
