package io.csfaceit.backend.clip;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Arrays;
import java.util.List;

/**
 * The frame rate a clip is recorded at, chosen with its order like its {@link ClipQuality}. In JSON a frame rate is
 * its number of frames per second, {@code 60}, {@code 120} or {@code 240}; a number that is none of them is rejected
 * when the request body is read. {@code clips.fps} holds the number, so a clip keeps the frame rate it was ordered at.
 */
public enum ClipFps {
    FPS_60(60),
    FPS_120(120),
    FPS_240(240);

    /** The frame rate of an order that names none. */
    public static final ClipFps DEFAULT = FPS_60;

    private final int value;

    ClipFps(int value) {
        this.value = value;
    }

    /** The frames per second a recorder is asked for. */
    @JsonValue
    public int value() {
        return value;
    }

    /** @throws IllegalArgumentException when the number is not the frame rate of any constant */
    @JsonCreator
    public static ClipFps of(int value) {
        return Arrays.stream(values())
                .filter(fps -> fps.value == value)
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unknown frame rate " + value + "; expected one of "
                        + numbers()));
    }

    /** The frame rates to choose from, as numbers, in the order a page lists them. */
    public static List<Integer> numbers() {
        return Arrays.stream(values()).map(ClipFps::value).toList();
    }
}
