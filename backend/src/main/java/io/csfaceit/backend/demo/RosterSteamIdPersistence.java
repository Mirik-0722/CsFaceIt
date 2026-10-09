package io.csfaceit.backend.demo;

import io.csfaceit.backend.player.Player;
import io.csfaceit.backend.player.PlayerService;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The database writes behind {@link RosterSteamIdMapper}. It is a bean of its own so that the transaction proxy
 * applies: the mapper does its checking with no transaction open and calls in here for one short, atomic write.
 *
 * <p>When a concurrent request inserts the same player first, or claims the same SteamID, PostgreSQL fails the write
 * with a unique violation, which aborts the whole transaction and surfaces as a
 * {@link org.springframework.dao.DataIntegrityViolationException}; nothing is recovered in here. The caller repeats
 * the whole method, and the repeat finds the other request's rows.
 */
@Component
public class RosterSteamIdPersistence {

    /** A roster player and the SteamID FACEIT reports for them. */
    public record Entry(String faceitId, String nickname, String steamId) {
    }

    private final PlayerService players;

    public RosterSteamIdPersistence(PlayerService players) {
        this.players = players;
    }

    /**
     * Finds or creates the player of every entry and gives them the SteamID of the entry (see
     * {@link PlayerService#assignSteamId}). Either all of it is written or none.
     *
     * @return how many players got a different SteamID than they had
     */
    @Transactional
    public int assign(List<Entry> entries) {
        int changed = 0;
        for (Entry entry : entries) {
            Player player = players.ensurePlayer(entry.faceitId(), entry.nickname());
            if (players.assignSteamId(player, entry.steamId())) {
                changed++;
            }
        }
        return changed;
    }
}
