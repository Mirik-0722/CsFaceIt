package io.csfaceit.backend.clip;

/**
 * What a clip shows: the moment of one highlight, every kill of one player in one match cut into a single video, or a
 * montage, the stretches of one match the player picked himself in the editor, in his order and with options of his own
 * ({@link MontageOptions}). A clip is stored by the name of its kind ({@code clips.kind}), so a constant is renamed only
 * together with the rows.
 */
public enum ClipKind {
    HIGHLIGHT,
    COMPILATION,
    MONTAGE
}
