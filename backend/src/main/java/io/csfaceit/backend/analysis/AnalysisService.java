package io.csfaceit.backend.analysis;

import io.csfaceit.backend.analysis.AnalysisPersistence.Claim;
import io.csfaceit.backend.analysis.facts.FactsLoader;
import io.csfaceit.backend.analysis.facts.MatchFacts;
import io.csfaceit.backend.analysis.highlight.HighlightCandidate;
import io.csfaceit.backend.analysis.highlight.HighlightDetector;
import io.csfaceit.backend.analysis.stats.PlayerMatchStatsValues;
import io.csfaceit.backend.analysis.stats.StatsCalculator;
import io.csfaceit.backend.demo.DemoPersistence;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Turns the facts the parser wrote for a demo into the statistics and the highlights of its players, and the demo into
 * ANALYZED. Like the other services it opens no transaction itself: the demo is taken over in one short transaction of
 * {@link AnalysisPersistence}, the facts are read and the numbers computed with none open, and the result is
 * written in a second one.
 *
 * <p>Analyzing is idempotent: the same facts give the same rows, and the highlights of the match are replaced rather
 * than added to, so an analysis can be repeated at any time (a duplicate {@code demo.parsed}, a request to analyze
 * again) without harm. An exception is not caught here: it reaches the listener, which logs it, and the message is
 * tried again and finally dead-lettered (see {@code DemoParsedListener} and {@code DemoDlqListener}).
 *
 * <p>Facts that have no roster at all (a demo parsed before the rosters were recorded, or one whose positions could not
 * be read) are not analyzed: the sides of a round would be only what its kill events name, and the figures and the
 * clutches would be wrong. That is a property of the facts and no failure to try again, so there is no exception: the
 * error {@link #NO_ROSTERS_ERROR} is noted on the demo (when it is PARSED), a WARN is logged and the message is
 * done.
 */
@Service
public class AnalysisService {

    /** What {@link #analyze} did with the demo. */
    public enum Outcome {
        /** The statistics and the highlights are stored and the demo is ANALYZED. */
        ANALYZED,
        /** There was nothing to analyze: the demo does not exist or is not PARSED (or ANALYZED). */
        SKIPPED,
        /** The demo changed while it was analyzed (uploaded or parsed again), so the result was dropped. */
        STALE,
        /** The facts have no roster: nothing was analyzed or stored, and the demo's error says to upload it again. */
        NO_ROSTERS
    }

    /** What {@code demos.error} says of a PARSED demo whose facts have no roster. */
    static final String NO_ROSTERS_ERROR = "The demo was parsed without round rosters: upload the demo file again";

    private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);

    /** The order highlights are stored in, so that it does not depend on the order Spring hands the detectors over. */
    private static final Comparator<HighlightCandidate> STORAGE_ORDER = Comparator
            .comparingInt(HighlightCandidate::roundNumber)
            .thenComparingInt(HighlightCandidate::firstTick)
            .thenComparing(HighlightCandidate::type)
            .thenComparingLong(HighlightCandidate::playerId);

    private final AnalysisPersistence persistence;
    private final DemoPersistence demos;
    private final FactsLoader loader;
    private final StatsCalculator calculator;
    private final List<HighlightDetector> detectors;

    public AnalysisService(AnalysisPersistence persistence, DemoPersistence demos, FactsLoader loader,
                           StatsCalculator calculator, List<HighlightDetector> detectors) {
        this.persistence = persistence;
        this.demos = demos;
        this.loader = loader;
        this.calculator = calculator;
        this.detectors = List.copyOf(detectors);
    }

    public Outcome analyze(long demoId) {
        Optional<Claim> claimed = persistence.claim(demoId);
        if (claimed.isEmpty()) {
            log.info("Skipping the analysis of demo {}: there is no such demo, or it is not parsed", demoId);
            return Outcome.SKIPPED;
        }
        Claim claim = claimed.get();
        MatchFacts facts = loader.load(claim.matchRowId(), claim.tickRate());
        if (!facts.rosterRecorded()) {
            boolean noted = demos.noteAnalysisFailure(claim.demoId(), NO_ROSTERS_ERROR);
            log.warn("Not analyzing demo {} of match {}: its facts have no round rosters ({}); the demo file has to be "
                    + "uploaded again", demoId, claim.faceitMatchId(),
                    noted ? "the error is noted on the demo" : "the demo is not PARSED, so it is left as it is");
            return Outcome.NO_ROSTERS;
        }
        Map<Long, PlayerMatchStatsValues> stats = calculator.calculate(facts);
        List<HighlightCandidate> highlights = detectors.stream()
                .flatMap(detector -> detector.detect(facts).stream())
                // Two kills of one player on one tick with the same flag (an AWP bullet through smoke or a wall)
                // give equal candidates: one moment, one highlight, not one for each victim.
                .distinct()
                .sorted(STORAGE_ORDER)
                .toList();
        if (!persistence.store(claim, stats, highlights, facts)) {
            log.info("Dropping the analysis of demo {} of match {}: the demo changed while it was analyzed; the new "
                    + "upload or parse announces itself", demoId, claim.faceitMatchId());
            return Outcome.STALE;
        }
        log.info("Analyzed demo {} of match {}: {} rounds, {} players, {} highlights found", demoId,
                claim.faceitMatchId(), facts.rounds().size(), stats.size(), highlights.size());
        return Outcome.ANALYZED;
    }
}
