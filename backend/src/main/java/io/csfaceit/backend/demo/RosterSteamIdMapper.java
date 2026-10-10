package io.csfaceit.backend.demo;

import io.csfaceit.backend.demo.RosterSteamIdPersistence.Entry;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchTeam;
import io.csfaceit.backend.faceit.dto.FaceitRosterPlayer;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.IntSupplier;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

/**
 * Teaches the database which SteamID belongs to which FACEIT player of a match. The demo parser knows a player by
 * SteamID only and looks the row up by {@code players.steam_id}, so this has to be done before a demo is queued for
 * parsing. Like {@code MatchService} it opens no transaction itself: it checks the roster, and the write is the one
 * short transaction of {@link RosterSteamIdPersistence}.
 *
 * <p>FACEIT calls the SteamID of a roster player {@code game_player_id}. A roster entry without one is skipped without
 * a line of its own; one whose value is not a SteamID (17 digits), that has no id or nickname, or that repeats a
 * player or a SteamID of the same roster, is skipped with a WARN. A bad entry never fails the others. Whatever the
 * reasons, a call that finds fewer usable SteamIDs than the roster has players logs one more WARN with the two
 * counts: the demo parser may then meet players it cannot look up by SteamID.
 */
@Component
public class RosterSteamIdMapper {

    /** A SteamID64 is 17 decimal digits. */
    private static final Pattern STEAM_ID = Pattern.compile("[0-9]{17}");

    private static final Logger log = LoggerFactory.getLogger(RosterSteamIdMapper.class);

    private final RosterSteamIdPersistence persistence;

    public RosterSteamIdMapper(RosterSteamIdPersistence persistence) {
        this.persistence = persistence;
    }

    /** Stores the SteamIDs of the roster of {@code match}, creating the players that are not stored yet. */
    public void apply(FaceitMatch match) {
        Roster roster = roster(match);
        List<Entry> entries = roster.entries();
        if (entries.size() < roster.players()) {
            log.warn("The roster of match {} has {} players, but only {} of them have a usable SteamID; the demo "
                    + "parser may not find the others by SteamID", match.matchId(), roster.players(), entries.size());
        }
        if (entries.isEmpty()) {
            return;
        }
        int changed = persistWithRetry("the SteamIDs of match " + match.matchId(),
                () -> persistence.assign(entries));
        if (changed > 0) {
            log.info("Set the SteamID of {} players of match {}", changed, match.matchId());
        }
    }

    /** What a match's roster yields: the usable entries, and how many players the roster lists. */
    private record Roster(List<Entry> entries, int players) {
    }

    /**
     * The usable roster entries, in the order of their FACEIT ids (players are always locked in the same order), and
     * the number of players the roster lists.
     */
    private static Roster roster(FaceitMatch match) {
        if (match == null || match.teams() == null) {
            return new Roster(List.of(), 0);
        }
        Map<String, Entry> byPlayer = new TreeMap<>();
        Set<String> steamIds = new HashSet<>();
        int players = 0;
        for (FaceitMatchTeam team : match.teams().values()) {
            if (team == null || team.roster() == null) {
                continue;
            }
            for (FaceitRosterPlayer player : team.roster()) {
                if (player == null) {
                    continue;
                }
                players++;
                if (player.gamePlayerId() == null || player.gamePlayerId().isBlank()) {
                    continue;
                }
                if (player.playerId() == null || player.playerId().isBlank() || player.nickname() == null
                        || player.nickname().isBlank()) {
                    log.warn("Ignoring a roster player of match {} that has no FACEIT id or nickname", match.matchId());
                    continue;
                }
                String steamId = player.gamePlayerId();
                if (!STEAM_ID.matcher(steamId).matches()) {
                    log.warn("Ignoring the game player id '{}' of FACEIT player {} in match {}: it is not a "
                            + "17-digit SteamID", printable(steamId), printable(player.playerId()), match.matchId());
                    continue;
                }
                if (byPlayer.containsKey(player.playerId())) {
                    log.warn("Ignoring FACEIT player {} listed twice in the roster of match {}",
                            printable(player.playerId()), match.matchId());
                    continue;
                }
                if (!steamIds.add(steamId)) {
                    log.warn("Ignoring SteamID {} of FACEIT player {} in match {}: another player of the roster has "
                            + "it", steamId, printable(player.playerId()), match.matchId());
                    continue;
                }
                byPlayer.put(player.playerId(), new Entry(player.playerId(), player.nickname(), steamId));
            }
        }
        return new Roster(List.copyOf(byPlayer.values()), players);
    }

    /**
     * Runs the write and, if it loses a first-access race, runs it once more. Two requests that meet an unseen player
     * both find nothing and both insert, or claim one SteamID for two rows; PostgreSQL fails the loser's statement with
     * a unique violation (or, when requests write the same players in a different order, a deadlock), which aborts
     * that transaction. The repeat is a new transaction that finds what the winner committed. A second failure is
     * real and propagates.
     */
    private static int persistWithRetry(String what, IntSupplier persist) {
        try {
            return persist.getAsInt();
        } catch (DataIntegrityViolationException | ConcurrencyFailureException e) {
            log.info("Lost a concurrent first-access write race for {} ({}), retrying once", what,
                    e.getClass().getSimpleName());
            return persist.getAsInt();
        }
    }

    /** A value from FACEIT in a log line must not spoil it: control characters go, and the length is bounded. */
    private static String printable(String value) {
        String cleaned = value.replaceAll("\\p{Cntrl}", "?");
        return cleaned.length() <= 64 ? cleaned : cleaned.substring(0, 64) + "...";
    }
}
