package io.csfaceit.backend.analysis.highlight;

/**
 * The kinds of highlight the analysis finds in a demo; the README has the rule of each. A highlight is stored by the
 * name of its type ({@code highlights.type}), so a constant is renamed only together with the rows.
 */
public enum HighlightType {
    ACE,
    K4,
    K3,
    CLUTCH_1V1,
    CLUTCH_1V2,
    CLUTCH_1V3,
    CLUTCH_1V4,
    CLUTCH_1V5,
    NO_SCOPE,
    KNIFE_KILL,
    WALLBANG,
    SMOKE_KILL,
    NINJA_DEFUSE
}
