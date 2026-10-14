package io.csfaceit.backend.player;

import io.csfaceit.backend.common.api.NotFoundException;
import io.csfaceit.backend.common.log.SteamIds;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.FaceitNotFoundException;
import io.csfaceit.backend.faceit.dto.FaceitGame;
import io.csfaceit.backend.faceit.dto.FaceitHistoryItem;
import io.csfaceit.backend.faceit.dto.FaceitHistoryTeam;
import io.csfaceit.backend.faceit.dto.FaceitMatchHistory;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import io.csfaceit.backend.faceit.dto.FaceitResults;
import io.csfaceit.backend.player.dto.MatchHistoryResponse;
import io.csfaceit.backend.player.dto.MatchResult;
import io.csfaceit.backend.player.dto.MatchSummary;
import io.csfaceit.backend.player.dto.PlayerResponse;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlayerService {

    private static final String PLAYER_NOT_FOUND = "PLAYER_NOT_FOUND";

    /**
     * The FACEIT id of a player row that the demo parser creates for a SteamID it cannot match to anyone is
     * {@code steam:<SteamID>}. Such a row stands in for a player until the real one is known.
     */
    private static final String STEAM_PLACEHOLDER_PREFIX = "steam:";

    private static final Logger log = LoggerFactory.getLogger(PlayerService.class);

    private final FaceitGateway faceit;
    private final PlayerRepository players;

    public PlayerService(FaceitGateway faceit, PlayerRepository players) {
        this.faceit = faceit;
        this.players = players;
    }

    /** Looks the player up on FACEIT by nickname and stores the fresh nickname, elo and level. */
    public PlayerResponse findByNickname(String nickname) {
        FaceitPlayer found;
        try {
            found = faceit.findPlayerByNickname(nickname);
        } catch (FaceitNotFoundException e) {
            throw playerNotFound(nickname);
        }
        upsert(found);
        return toResponse(found);
    }

    /**
     * Loads the player's profile from FACEIT by id and stores the fresh nickname, elo and level. A player known only
     * from demos ({@code steam:<SteamID>}, a matchmaking player) is answered from the database alone: FACEIT has no
     * profile for that id. See {@link #getFromDatabase}.
     */
    public PlayerResponse getById(String playerId) {
        if (isSteamPlayerId(playerId)) {
            return getFromDatabase(playerId);
        }
        FaceitPlayer found;
        try {
            found = faceit.getPlayer(playerId);
        } catch (FaceitNotFoundException e) {
            throw playerNotFound(playerId);
        }
        upsert(found);
        return toResponse(found);
    }

    public MatchHistoryResponse getHistory(String playerId, int offset, int limit) {
        FaceitMatchHistory history;
        try {
            history = faceit.getHistory(playerId, offset, limit);
        } catch (FaceitNotFoundException e) {
            throw playerNotFound(playerId);
        }
        List<FaceitHistoryItem> items = history.items() == null ? List.of() : history.items();
        List<MatchSummary> summaries = items.stream().map(item -> toSummary(item, playerId)).toList();
        return new MatchHistoryResponse(summaries, offset, limit);
    }

    /**
     * Finds the player row by FACEIT id or creates it, then refreshes nickname, elo and level from the FACEIT
     * profile (elo and level become {@code null} when the profile has no CS2 section).
     */
    public Player upsert(FaceitPlayer profile) {
        Integer elo = elo(profile);
        Integer level = level(profile);

        Player player = players.findByFaceitId(profile.playerId()).orElse(null);
        if (player == null) {
            try {
                return players.saveAndFlush(new Player(profile.playerId(), profile.nickname(), elo, level));
            } catch (DataIntegrityViolationException e) {
                // A concurrent request inserted the same FACEIT id first; refresh that row instead.
                player = players.findByFaceitId(profile.playerId()).orElseThrow(() -> e);
            }
        }
        player.setNickname(profile.nickname());
        player.setElo(elo);
        player.setLevel(level);
        return players.save(player);
    }

    /**
     * Finds the player row by FACEIT id or creates it without elo and level, and refreshes the nickname when it
     * changed. Unlike {@link #upsert(FaceitPlayer)} it never touches the elo or level of an existing row, because
     * the match endpoints only learn a nickname, not a rating.
     *
     * <p>Meant to run inside the caller's transaction (all rows of a match are written atomically). That is why a
     * concurrent insert of the same FACEIT id is not recovered here the way {@link #upsert(FaceitPlayer)}
     * recovers it: on PostgreSQL the failed insert aborts the whole transaction, so it surfaces as a
     * {@link DataIntegrityViolationException} and the caller repeats the transaction
     * ({@code MatchService} does, once).
     */
    public Player ensurePlayer(String faceitId, String nickname) {
        Player player = players.findByFaceitId(faceitId).orElse(null);
        if (player == null) {
            return players.save(new Player(faceitId, nickname, null, null));
        }
        if (!nickname.equals(player.getNickname())) {
            player.setNickname(nickname);
            return players.save(player);
        }
        return player;
    }

    /**
     * Makes {@code steamId} the SteamID of the player, so that the demo parser, which knows a player by SteamID only,
     * finds the row. Another row that already holds the SteamID is a placeholder of the parser ({@code steam:<id>})
     * and loses it, which is logged; if it is a real player the SteamID stays where it is, because taking it away
     * would silently move the statistics of one person to another. A player that has a different SteamID gets the new
     * one: the roster of the match being parsed is what its demo contains.
     *
     * <p>Meant to run inside the caller's transaction, like {@link #ensurePlayer}; a concurrent write of the same
     * SteamID fails the unique index and the caller repeats the transaction.
     *
     * @return whether the SteamID of the player was changed
     */
    public boolean assignSteamId(Player player, String steamId) {
        if (steamId.equals(player.getSteamId())) {
            return false;
        }
        Player holder = players.findBySteamId(steamId).orElse(null);
        if (holder != null && !holder.getId().equals(player.getId())) {
            if (!holder.getFaceitId().startsWith(STEAM_PLACEHOLDER_PREFIX)) {
                log.warn("SteamID {} belongs to player {} already; not giving it to player {}", SteamIds.mask(steamId),
                        SteamIds.maskPlayerId(holder.getFaceitId()), SteamIds.maskPlayerId(player.getFaceitId()));
                return false;
            }
            log.warn("SteamID {} was held by the placeholder player {}; moving it to player {}", SteamIds.mask(steamId),
                    SteamIds.maskPlayerId(holder.getFaceitId()), SteamIds.maskPlayerId(player.getFaceitId()));
            holder.setSteamId(null);
            // The unique index must be free before the same value is written to the other row.
            players.saveAndFlush(holder);
        }
        player.setSteamId(steamId);
        players.save(player);
        return true;
    }

    /**
     * Makes {@code steamId} the SteamID of the player row, at sign-in, where the visitor has just proved with Steam that
     * the SteamID is theirs and FACEIT that the player is: from then on the parser files the visitor's matchmaking kills
     * under this row, not under a second one of their own ({@code steam:<SteamID>}). Unlike {@link #assignSteamId} the
     * latest proof wins over a real player too (a Steam account that moved to another FACEIT account), like the FACEIT
     * link itself does: the other row loses the SteamID. Statistics a placeholder row {@code steam:<SteamID>} holds
     * already stay on it; nothing is merged here.
     *
     * <p>One transaction of its own. A concurrent write of the same SteamID fails the unique index and reaches the
     * caller.
     *
     * @return whether the row's SteamID changed
     */
    @Transactional
    public boolean claimSteamId(long playerRowId, String steamId) {
        Player player = players.findById(playerRowId).orElse(null);
        if (player == null || steamId.equals(player.getSteamId())) {
            return false;
        }
        Player holder = players.findBySteamId(steamId).orElse(null);
        if (holder != null && !holder.getId().equals(player.getId())) {
            log.info("SteamID {} moves from player {} to player {}, who signed in with it", SteamIds.mask(steamId),
                    SteamIds.maskPlayerId(holder.getFaceitId()), SteamIds.maskPlayerId(player.getFaceitId()));
            holder.setSteamId(null);
            // The unique index must be free before the same value is written to the other row.
            players.saveAndFlush(holder);
        }
        player.setSteamId(steamId);
        players.save(player);
        return true;
    }

    /** Whether the id names a player known only from demos: {@code steam:<SteamID>}. */
    public static boolean isSteamPlayerId(String playerId) {
        return playerId != null && playerId.startsWith(STEAM_PLACEHOLDER_PREFIX);
    }

    /**
     * The profile of a player known from demos, from the database: the row {@code steam:<SteamID>} the parser made, or,
     * when there is none, the row that carries the SteamID (a FACEIT player who signed in; the answer then names that
     * player's id). Elo and level are what the row has; there is no avatar or country.
     *
     * @throws NotFoundException {@code PLAYER_NOT_FOUND}: no row has the id or the SteamID
     */
    private PlayerResponse getFromDatabase(String playerId) {
        String steamId = playerId.substring(STEAM_PLACEHOLDER_PREFIX.length());
        Player row = players.findByFaceitId(playerId)
                .or(() -> players.findBySteamId(steamId))
                .orElseThrow(() -> playerNotFound(playerId));
        return new PlayerResponse(row.getFaceitId(), row.getNickname(), null, null, row.getElo(), row.getLevel());
    }

    private static PlayerResponse toResponse(FaceitPlayer profile) {
        return new PlayerResponse(profile.playerId(), profile.nickname(), profile.avatar(), profile.country(),
                elo(profile), level(profile));
    }

    private static Integer elo(FaceitPlayer profile) {
        return profile.cs2().map(FaceitGame::faceitElo).orElse(null);
    }

    private static Integer level(FaceitPlayer profile) {
        return profile.cs2().map(FaceitGame::skillLevel).orElse(null);
    }

    private static MatchSummary toSummary(FaceitHistoryItem item, String playerId) {
        FaceitResults results = item.results();
        Map<String, Integer> score = results == null || results.score() == null ? Map.of() : results.score();
        return new MatchSummary(item.matchId(), Instant.ofEpochSecond(item.startedAt()),
                Instant.ofEpochSecond(item.finishedAt()), resultFor(item, playerId), score);
    }

    /** WIN or LOSS from the faction the player played in; UNKNOWN when the player or the winner is not listed. */
    private static MatchResult resultFor(FaceitHistoryItem item, String playerId) {
        String winner = item.results() == null ? null : item.results().winner();
        if (winner == null || item.teams() == null) {
            return MatchResult.UNKNOWN;
        }
        return item.teams().entrySet().stream()
                .filter(team -> isOnTeam(team.getValue(), playerId))
                .findFirst()
                .map(team -> winner.equals(team.getKey()) ? MatchResult.WIN : MatchResult.LOSS)
                .orElse(MatchResult.UNKNOWN);
    }

    private static boolean isOnTeam(FaceitHistoryTeam team, String playerId) {
        return team != null && team.players() != null
                && team.players().stream().anyMatch(p -> p != null && playerId.equals(p.playerId()));
    }

    private static NotFoundException playerNotFound(String player) {
        return new NotFoundException(PLAYER_NOT_FOUND, "Player not found: " + player);
    }
}
