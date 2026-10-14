package io.csfaceit.backend.analysis;

import io.csfaceit.backend.analysis.facts.MatchFacts;
import io.csfaceit.backend.demo.DemoMatchCheckProperties;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.FaceitNotFoundException;
import io.csfaceit.backend.faceit.dto.FaceitMatch;
import io.csfaceit.backend.faceit.dto.FaceitMatchTeam;
import io.csfaceit.backend.faceit.dto.FaceitRosterPlayer;
import io.csfaceit.backend.match.MatchSource;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Tells whether a parsed demo is the demo of the match it is stored for, before the analysis lets it replace the
 * statistics and the highlights of the match's players. Nothing else tells a file of another game from the right one:
 * the parser reads whatever it is given. The check is on the players, by SteamID.
 *
 * <p>The roster of the match is FACEIT's answer for it ({@link FaceitGateway#getMatch}, the answer that an upload or an
 * import has just put in the cache), where a roster player's SteamID is what FACEIT calls {@code game_player_id}. The
 * players of the demo are those of the facts ({@link MatchFacts#players}) with the SteamID of their {@code players}
 * row: the column {@code steam_id}, or, for a player known from a demo only whose SteamID has been given to a real
 * player since, the SteamID in his placeholder id {@code steam:<SteamID>} (the parser takes the placeholder for that
 * SteamID too).
 *
 * <p>The rule: the roster's SteamIDs that are among the demo's are counted, and that count has to reach
 * {@code demo.match-check.min-share} of the smaller of two numbers: the roster's players whose SteamID is known, and the
 * demo's players that have a real 17-digit SteamID. The smaller, because a roster that lists substitutes (fourteen
 * entries, say) cannot be wholly present in a demo of ten players, and a genuine demo must not fail for it. Players of
 * the demo who are not in the roster do not count against it, and nor do roster players without a SteamID. Fewer than
 * {@value #MIN_KNOWN_STEAM_IDS} roster players with a known SteamID are too few to judge by, and a demo none of whose
 * players has a real SteamID has nothing to compare: either way the check is skipped, with one WARN that names the match
 * and the counts. A match FACEIT no longer knows has no roster, and is skipped the same way; a FACEIT that cannot be
 * reached is no verdict, so its exception goes to the caller, and the analysis is tried again like for any other failure.
 *
 * <p>A matchmaking match ({@code mm-<id>}) has no roster but its demo, and FACEIT is not asked about it. Its rule is the
 * owner's: the SteamID of the user who brought the match in has to be among the demo's players; a match without an owner
 * is skipped.
 *
 * <p>No SteamID or nickname is written to a log or to a sentence that is stored: they are real people's.
 */
@Component
public class RosterCheck {

    /** The fewest roster players with a known SteamID that a demo is judged by. */
    public static final int MIN_KNOWN_STEAM_IDS = 6;

    /** A SteamID64 is 17 decimal digits, as {@code RosterSteamIdMapper} takes it. */
    private static final Pattern STEAM_ID = Pattern.compile("[0-9]{17}");

    /**
     * The SteamID of each player row among {@code :ids}: the column, else the one in a placeholder id. A player who
     * has neither gives null, and is left out.
     */
    private static final String STEAM_IDS_SQL = """
            SELECT coalesce(steam_id, CASE WHEN faceit_id ~ '^steam:[0-9]{17}$' THEN substr(faceit_id, 7) END)
            FROM players
            WHERE id IN (:ids)""";

    /** The SteamID of the user who brought a matchmaking match in; no row when the match has no owner. */
    private static final String OWNER_STEAM_ID_SQL = """
            SELECT u.steam_id
            FROM matches m
            JOIN users u ON u.id = m.owner_user_id
            WHERE m.faceit_match_id = :matchId""";

    private static final Logger log = LoggerFactory.getLogger(RosterCheck.class);

    /** What the check made of a demo. */
    public enum Kind {
        /** Enough of the roster is among the demo's players. */
        SAME_MATCH,
        /** Too few roster players have a known SteamID to judge by; the demo is taken as it is. */
        SKIPPED,
        /** Too few of the roster's players are among the demo's players: the demo is another match's. */
        WRONG_MATCH
    }

    /**
     * The result: {@code rosterPlayers} players in the roster, {@code known} of them with a known SteamID,
     * {@code demoPlayers} players of the demo with a real SteamID and {@code present} roster SteamIDs among them (the
     * last two are 0 when the check was skipped before the demo's players were read). {@code ownerRule} is set for a
     * matchmaking match, whose "roster" is its owner alone.
     */
    public record Verdict(Kind kind, int rosterPlayers, int known, int demoPlayers, int present, boolean ownerRule) {

        /** A verdict on a FACEIT match, by its roster. */
        public Verdict(Kind kind, int rosterPlayers, int known, int demoPlayers, int present) {
            this(kind, rosterPlayers, known, demoPlayers, present, false);
        }

        /** What {@code present} is measured against: the smaller of the known roster SteamIDs and the demo's. */
        public int compared() {
            return Math.min(known, demoPlayers);
        }

        public boolean wrongMatch() {
            return kind == Kind.WRONG_MATCH;
        }

        /** The sentence that goes to {@code demos.error} of a demo that is another match's. */
        public String sentence() {
            if (ownerRule) {
                return "The demo is not a game of the player this matchmaking match belongs to: they are not among its "
                        + demoPlayers + " players";
            }
            return "The players of the demo are not the players of this match: only " + present + " of the " + compared()
                    + " SteamIDs compared are among them";
        }
    }

    private record Roster(int players, Set<String> steamIds) {
    }

    private final FaceitGateway faceit;
    private final JdbcClient jdbc;
    private final DemoMatchCheckProperties properties;

    public RosterCheck(FaceitGateway faceit, JdbcClient jdbc, DemoMatchCheckProperties properties) {
        this.faceit = faceit;
        this.jdbc = jdbc;
        this.properties = properties;
    }

    /**
     * Checks the facts of a demo against the roster of the match it is stored for.
     *
     * @param faceitMatchId the FACEIT match id the demo belongs to
     * @param facts the facts of the demo, which have a roster (see {@link MatchFacts#rosterRecorded})
     * @throws io.csfaceit.backend.faceit.FaceitUnavailableException FACEIT could not be asked and the cache has no copy
     *         of the match
     */
    public Verdict check(String faceitMatchId, MatchFacts facts) {
        if (MatchSource.isMatchmaking(faceitMatchId)) {
            return checkOwner(faceitMatchId, facts);
        }
        Roster roster = roster(faceitMatchId);
        int known = roster.steamIds().size();
        if (known < MIN_KNOWN_STEAM_IDS) {
            log.warn("Not checking the demo of match {} against its roster: only {} of the {} roster players have a "
                    + "known SteamID and {} are needed to judge by", faceitMatchId, known, roster.players(),
                    MIN_KNOWN_STEAM_IDS);
            return new Verdict(Kind.SKIPPED, roster.players(), known, 0, 0);
        }
        Set<String> demoSteamIds = demoSteamIds(facts);
        if (demoSteamIds.isEmpty()) {
            log.warn("Not checking the demo of match {} against its roster: none of the demo's players has a SteamID "
                    + "(the roster has {} players, {} of them with a known SteamID)", faceitMatchId, roster.players(),
                    known);
            return new Verdict(Kind.SKIPPED, roster.players(), known, 0, 0);
        }
        int present = (int) roster.steamIds().stream().filter(demoSteamIds::contains).count();
        int compared = Math.min(known, demoSteamIds.size());
        boolean enough = (double) present / compared >= properties.minShare();
        return new Verdict(enough ? Kind.SAME_MATCH : Kind.WRONG_MATCH, roster.players(), known, demoSteamIds.size(),
                present);
    }

    /**
     * The rule for a matchmaking match, which has no roster anywhere but its demo: the SteamID of the user who brought
     * the match in (its owner) has to be among the demo's players, or the demo is another game's. FACEIT is not asked. A
     * match without an owner (or whose owner has no SteamID) has nothing to compare, and is skipped with a WARN.
     */
    private Verdict checkOwner(String matchId, MatchFacts facts) {
        String ownerSteamId = jdbc.sql(OWNER_STEAM_ID_SQL).param("matchId", matchId).query(String.class)
                .optional().orElse(null);
        if (ownerSteamId == null || !STEAM_ID.matcher(ownerSteamId).matches()) {
            log.warn("Not checking the demo of matchmaking match {}: the match has no owner with a SteamID to look for "
                    + "among its players", matchId);
            return new Verdict(Kind.SKIPPED, 0, 0, 0, 0, true);
        }
        Set<String> demoSteamIds = demoSteamIds(facts);
        int present = demoSteamIds.contains(ownerSteamId) ? 1 : 0;
        return new Verdict(present == 1 ? Kind.SAME_MATCH : Kind.WRONG_MATCH, 1, 1, demoSteamIds.size(), present,
                true);
    }

    /** The roster of the match: how many players it lists and the distinct SteamIDs among them that are usable. */
    private Roster roster(String faceitMatchId) {
        FaceitMatch match;
        try {
            match = faceit.getMatch(faceitMatchId);
        } catch (FaceitNotFoundException e) {
            return new Roster(0, Set.of());
        }
        if (match == null || match.teams() == null) {
            return new Roster(0, Set.of());
        }
        int players = 0;
        Set<String> steamIds = new HashSet<>();
        for (FaceitMatchTeam team : match.teams().values()) {
            if (team == null || team.roster() == null) {
                continue;
            }
            for (FaceitRosterPlayer player : team.roster()) {
                if (player == null) {
                    continue;
                }
                players++;
                String steamId = player.gamePlayerId();
                if (steamId != null && STEAM_ID.matcher(steamId).matches()) {
                    steamIds.add(steamId);
                }
            }
        }
        return new Roster(players, steamIds);
    }

    private Set<String> demoSteamIds(MatchFacts facts) {
        Set<Long> players = facts.players();
        if (players.isEmpty()) {
            return Set.of();
        }
        return jdbc.sql(STEAM_IDS_SQL).param("ids", players).query(String.class).list().stream()
                .filter(Objects::nonNull)
                .filter(steamId -> STEAM_ID.matcher(steamId).matches())
                .collect(Collectors.toSet());
    }
}
