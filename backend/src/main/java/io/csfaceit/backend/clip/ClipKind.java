package io.csfaceit.backend.clip;

/**
 * What a clip shows: the moment of one highlight, or every kill of one player in one match cut into a single video. A
 * clip is stored by the name of its kind ({@code clips.kind}), so a constant is renamed only together with the rows.
 */
public enum ClipKind {
    HIGHLIGHT,
    COMPILATION
}
