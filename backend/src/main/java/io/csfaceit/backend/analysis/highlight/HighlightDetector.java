package io.csfaceit.backend.analysis.highlight;

import io.csfaceit.backend.analysis.facts.MatchFacts;
import java.util.List;

/**
 * One rule, or a few related ones, for finding highlights. A detector is a pure function of the facts of a match: it
 * reads and writes nothing, so the same facts always give the same candidates. Every implementation is a Spring
 * component, and {@code AnalysisService} asks all of them.
 */
public interface HighlightDetector {

    /**
     * @return the highlights the facts contain, in no particular order; empty when there are none
     */
    List<HighlightCandidate> detect(MatchFacts facts);
}
