package io.csfaceit.backend.clip.dto;

/**
 * One kill of an enemy that the video of a clip shows. {@code offsetMs} is where it happens on the timeline of the
 * finished video, not of the demo: the length of the segments before its own plus its distance from the start of its
 * segment. {@code weapon} is the raw name from the demo ({@code ak47}, {@code knife_t}).
 */
public record ClipKill(int offsetMs, String weapon, boolean headshot, String victimNickname) {
}
