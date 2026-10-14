package io.csfaceit.backend.analysis;

import io.csfaceit.backend.analysis.facts.MatchFacts;
import io.csfaceit.backend.analysis.facts.RoundFacts;
import io.csfaceit.backend.analysis.highlight.Highlight;
import io.csfaceit.backend.analysis.highlight.HighlightCandidate;
import io.csfaceit.backend.analysis.highlight.HighlightRepository;
import io.csfaceit.backend.analysis.stats.PlayerMatchStatsValues;
import io.csfaceit.backend.demo.Demo;
import io.csfaceit.backend.demo.DemoErrorCode;
import io.csfaceit.backend.demo.DemoRepository;
import io.csfaceit.backend.demo.DemoStatus;
import io.csfaceit.backend.match.Match;
import io.csfaceit.backend.match.MatchRepository;
import io.csfaceit.backend.match.PlayerMatchStats;
import io.csfaceit.backend.match.PlayerMatchStatsRepository;
import io.csfaceit.backend.player.PlayerRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The database side of {@link AnalysisService}. It is a bean of its own so that the transaction proxy applies: the
 * service loads and computes with no transaction open and calls in here twice, once to take over the demo and once to
 * store the result (the statistics and the highlights).
 *
 * <p>The status of a demo is changed only under its row lock, here as everywhere. The result is stored only if the
 * demo is still where the analysis found it: a demo that was uploaded again or parsed again meanwhile has a different
 * {@code updated_at} (the parser and a manual upload both refresh it), and the old result must not be written over
 * its new facts.
 */
@Component
public class AnalysisPersistence {

    /**
     * The ticks per second of a demo whose parser could not tell; the parser itself falls back on the same value.
     * Public because the read side of the highlights uses it to turn ticks into seconds.
     */
    public static final int DEFAULT_TICK_RATE = 64;

    /** The demo an analysis has taken over, as it was when it was read: {@code updatedAt} is its version, {@code status} PARSED or ANALYZED. */
    public record Claim(long demoId, long matchRowId, String faceitMatchId, int tickRate, Instant updatedAt,
                        DemoStatus status) {
    }

    private static final Logger log = LoggerFactory.getLogger(AnalysisPersistence.class);

    private final DemoRepository demos;
    private final MatchRepository matches;
    private final PlayerRepository players;
    private final PlayerMatchStatsRepository stats;
    private final HighlightRepository highlights;
    private final AnalysisProperties properties;

    public AnalysisPersistence(DemoRepository demos, MatchRepository matches, PlayerRepository players,
                               PlayerMatchStatsRepository stats, HighlightRepository highlights,
                               AnalysisProperties properties) {
        this.demos = demos;
        this.matches = matches;
        this.players = players;
        this.stats = stats;
        this.highlights = highlights;
        this.properties = properties;
    }

    /**
     * Reads the demo that is to be analyzed. Nothing is locked or written.
     *
     * @return empty when there is no such demo or it is neither PARSED (analyze it) nor ANALYZED (analyze it again);
     *         any other status means the facts are not there yet, or not there any more
     */
    @Transactional(readOnly = true)
    public Optional<Claim> claim(long demoId) {
        return demos.findById(demoId)
                .filter(demo -> isAnalyzable(demo.getStatus()))
                .map(demo -> new Claim(demoId, demo.getMatch().getId(), demo.getMatch().getFaceitMatchId(),
                        tickRateOf(demo), demo.getUpdatedAt(), demo.getStatus()));
    }

    /**
     * Writes the statistics and the highlights of the match and moves a PARSED demo to ANALYZED (which clears an error
     * left by an analysis that failed), in one transaction under the row lock of the demo.
     *
     * <p>Nothing is written when the demo is no longer PARSED or ANALYZED, or its {@code updated_at} is not the one
     * the claim saw: the demo was uploaded or parsed again while it was analyzed, and the new upload announces itself.
     *
     * <p>The rows an earlier analysis owns ({@code rounds_played} is set) of players that {@code values} does not
     * mention are deleted first: the roster of a new parse differs, or another demo was uploaded to the match, and such
     * a row would keep the kills, deaths, ADR and result of the old analysis for good, and the player's totals would
     * count it. Rows only FACEIT's numbers fill ({@code rounds_played} is null) are not touched; FACEIT's writer
     * recreates the row of a FACEIT player the next time the match statistics are fetched. Then all remaining rows of
     * the match lose what an earlier analysis put in them ({@code rounds_played}, {@code kast} and the entry, trade and
     * clutch counts), and every player of {@code values} gets his row (created when the match has none) with all of
     * his statistics. {@code won} is written only into a row that has none: FACEIT's own result is the official one and
     * replaces it whenever the match statistics are fetched (see {@code MatchPersistence}).
     *
     * <p>The highlights of the match are replaced as a whole: the ones an earlier analysis stored are deleted and
     * {@code candidates} are inserted in their place, in the same transaction and under the same lock, so an analysis
     * that is repeated cannot leave duplicates and one that fails leaves the earlier set as it was. A candidate becomes
     * a clip of its round: the clip starts {@code analysis.clip.pre-seconds} before its first tick and ends
     * {@code analysis.clip.post-seconds} after its last, as ticks of {@code facts.tickRate()}, but never outside the
     * round (it starts no earlier than the round's {@code start_tick} and ends no later than its {@code end_tick}). A
     * candidate of a round that {@code facts} does not have, or whose event lies wholly outside its round, is dropped
     * and logged at WARN.
     *
     * @param facts the facts {@code candidates} and {@code values} were computed from
     * @return false when nothing was written
     */
    @Transactional
    public boolean store(Claim claim, Map<Long, PlayerMatchStatsValues> values, List<HighlightCandidate> candidates,
                         MatchFacts facts) {
        Demo demo = demos.findByIdForUpdate(claim.demoId()).orElse(null);
        if (demo == null || !isAnalyzable(demo.getStatus()) || !claim.updatedAt().equals(demo.getUpdatedAt())) {
            return false;
        }
        // Bulk statements leave the persistence context as it is, so both run before any row of the match is loaded.
        stats.deleteAnalyzedExcept(claim.matchRowId(), values.keySet());
        stats.clearAnalysis(claim.matchRowId());
        Match match = matches.getReferenceById(claim.matchRowId());
        for (Map.Entry<Long, PlayerMatchStatsValues> entry : values.entrySet()) {
            write(match, claim.matchRowId(), entry.getKey(), entry.getValue());
        }
        replaceHighlights(match, claim, candidates, facts);
        if (demo.getStatus() == DemoStatus.PARSED) {
            demo.transitionTo(DemoStatus.ANALYZED);
            demos.saveAndFlush(demo);
        }
        return true;
    }

    /**
     * Fails the demo as another match's: FACEIT's roster does not fit its players (see {@link RosterCheck}). The demo
     * becomes FAILED with the code {@link DemoErrorCode#WRONG_MATCH} and {@code error}, in one transaction under the
     * row lock of the demo, and nothing of the analysis is written: the statistics and the highlights of the match stay
     * as the last analysis left them, and are not served while the demo is not ANALYZED.
     *
     * <p>The guard is that of {@link #store}, narrowed: the demo has to be PARSED still (the check is made only for a
     * PARSED demo, and an ANALYZED one is never failed by it), with the {@code updated_at} the claim saw. A demo that was uploaded or parsed again meanwhile is not failed for the sake of the file before
     * it, and a second delivery of the same message that comes after the first has failed the demo finds it FAILED and
     * writes nothing, so the failure is neither undone nor repeated (the claim of a FAILED demo is empty to begin with).
     *
     * <p>The parser writes the map of the demo onto a match that has none ({@code matches.map_name}) when it parses,
     * before this check. A matchmaking match has no map but its demo's, so a first demo that is another game's would
     * leave that game's map on the match for good (the parser fills only an empty map): for a matchmaking match the
     * map is forgotten here, in the same transaction, and the right demo fills it again. A FACEIT match keeps its map,
     * which is FACEIT's.
     *
     * @return false when nothing was written
     */
    @Transactional
    public boolean failWrongMatch(Claim claim, String error) {
        Demo demo = demos.findByIdForUpdate(claim.demoId()).orElse(null);
        if (demo == null || demo.getStatus() != DemoStatus.PARSED || !claim.updatedAt().equals(demo.getUpdatedAt())) {
            return false;
        }
        demo.fail(error, DemoErrorCode.WRONG_MATCH);
        demos.saveAndFlush(demo);
        matches.clearMatchmakingMap(claim.matchRowId());
        return true;
    }

    private void replaceHighlights(Match match, Claim claim, List<HighlightCandidate> candidates, MatchFacts facts) {
        long matchRowId = claim.matchRowId();
        highlights.deleteByMatchId(matchRowId);
        Map<Integer, RoundFacts> rounds = facts.rounds().stream()
                .collect(Collectors.toMap(RoundFacts::roundNumber, Function.identity()));
        long lead = (long) properties.clip().preSeconds() * facts.tickRate();
        long tail = (long) properties.clip().postSeconds() * facts.tickRate();
        for (HighlightCandidate candidate : candidates) {
            RoundFacts round = rounds.get(candidate.roundNumber());
            if (round == null) {
                log.warn("Dropping a {} highlight of demo {} of match {}: round {} is not in its facts",
                        candidate.type(), claim.demoId(), claim.faceitMatchId(), candidate.roundNumber());
                continue;
            }
            // In long, so that no setting can overflow. A window that is kept lies between the ticks of the round,
            // which makes the casts below safe.
            long tickStart = Math.max(round.startTick(), candidate.firstTick() - lead);
            long tickEnd = Math.min(round.endTick(), candidate.lastTick() + tail);
            if (tickStart > tickEnd) {
                log.warn("Dropping a {} highlight of demo {} of match {}: its ticks {}-{} are outside round {} ({}-{})",
                        candidate.type(), claim.demoId(), claim.faceitMatchId(), candidate.firstTick(),
                        candidate.lastTick(), candidate.roundNumber(), round.startTick(), round.endTick());
                continue;
            }
            highlights.save(new Highlight(match, players.getReferenceById(candidate.playerId()), candidate.type(),
                    candidate.roundNumber(), (int) tickStart, (int) tickEnd));
        }
    }

    private void write(Match match, long matchRowId, long playerId, PlayerMatchStatsValues values) {
        PlayerMatchStats row = stats.findByPlayerIdAndMatchId(playerId, matchRowId)
                .orElseGet(() -> new PlayerMatchStats(players.getReferenceById(playerId), match));
        row.setKills(values.kills());
        row.setDeaths(values.deaths());
        row.setAssists(values.assists());
        row.setHeadshots(values.headshots());
        row.setAdr(values.adr());
        row.setRoundsPlayed(values.roundsPlayed());
        row.setKast(values.kast());
        row.setEntryKills(values.entryKills());
        row.setTradeKills(values.tradeKills());
        row.setClutchAttempts(values.clutchAttempts());
        row.setClutchWins(values.clutchWins());
        if (row.getWon() == null) {
            row.setWon(values.won());
        }
        stats.save(row);
    }

    private static boolean isAnalyzable(DemoStatus status) {
        return status == DemoStatus.PARSED || status == DemoStatus.ANALYZED;
    }

    private static int tickRateOf(Demo demo) {
        Integer tickRate = demo.getTickRate();
        return tickRate != null && tickRate > 0 ? tickRate : DEFAULT_TICK_RATE;
    }
}
