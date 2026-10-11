package io.csfaceit.backend.analysis;

import io.csfaceit.backend.analysis.AnalysisPersistence.Claim;
import io.csfaceit.backend.analysis.facts.FactsLoader;
import io.csfaceit.backend.analysis.facts.MatchFacts;
import io.csfaceit.backend.analysis.stats.PlayerMatchStatsValues;
import io.csfaceit.backend.analysis.stats.StatsCalculator;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Turns the facts the parser wrote for a demo into the statistics of its players, and the demo into ANALYZED.
 * Like the other services it opens no transaction itself: the demo is taken over in one short transaction of
 * {@link AnalysisPersistence}, the facts are read and the numbers computed with none open, and the result is
 * written in a second one.
 *
 * <p>Analyzing is idempotent: the same facts give the same rows, so an analysis can be repeated at any time (a
 * duplicate {@code demo.parsed}, a request to analyze again) without harm. An exception is not caught here: it
 * reaches the listener, which tries the message again and finally dead-letters it (see {@code DemoDlqListener}).
 */
@Service
public class AnalysisService {

    /** What {@link #analyze} did with the demo. */
    public enum Outcome {
        /** The statistics are stored and the demo is ANALYZED. */
        ANALYZED,
        /** There was nothing to analyze: the demo does not exist or is not PARSED (or ANALYZED). */
        SKIPPED,
        /** The demo changed while it was analyzed (uploaded or parsed again), so the result was dropped. */
        STALE
    }

    private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);

    private final AnalysisPersistence persistence;
    private final FactsLoader loader;
    private final StatsCalculator calculator;

    public AnalysisService(AnalysisPersistence persistence, FactsLoader loader, StatsCalculator calculator) {
        this.persistence = persistence;
        this.loader = loader;
        this.calculator = calculator;
    }

    public Outcome analyze(long demoId) {
        Optional<Claim> claimed = persistence.claim(demoId);
        if (claimed.isEmpty()) {
            log.info("Skipping the analysis of demo {}: there is no such demo, or it is not parsed", demoId);
            return Outcome.SKIPPED;
        }
        Claim claim = claimed.get();
        MatchFacts facts = loader.load(claim.matchRowId(), claim.tickRate());
        Map<Long, PlayerMatchStatsValues> stats = calculator.calculate(facts);
        if (!persistence.store(claim, stats)) {
            log.info("Dropping the analysis of demo {} of match {}: the demo changed while it was analyzed; the new "
                    + "upload or parse announces itself", demoId, claim.faceitMatchId());
            return Outcome.STALE;
        }
        log.info("Analyzed demo {} of match {}: {} rounds, {} players", demoId, claim.faceitMatchId(),
                facts.rounds().size(), stats.size());
        return Outcome.ANALYZED;
    }
}
