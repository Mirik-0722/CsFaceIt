package io.csfaceit.backend.clip;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

/**
 * The shape of the picture of a montage. In JSON a shape is its {@link #label}, {@code "16:9"} or {@code "9:16"}. A
 * landscape picture is the size of the {@link ClipQuality}; a portrait one, for a phone, is the same size on its side
 * (720p is 720 x 1280, 1080p is 1080 x 1920). Every clip that is no montage is landscape.
 */
public enum ClipAspect {
    LANDSCAPE("16:9"),
    PORTRAIT("9:16");

    private final String label;

    ClipAspect(String label) {
        this.label = label;
    }

    @JsonValue
    public String label() {
        return label;
    }

    /** The width of the picture a recorder is asked for at {@code quality}. */
    public int width(ClipQuality quality) {
        return this == PORTRAIT ? quality.height() : quality.width();
    }

    /** The height of the picture a recorder is asked for at {@code quality}. */
    public int height(ClipQuality quality) {
        return this == PORTRAIT ? quality.width() : quality.height();
    }

    /** Every label, in the order of the constants: what the editor offers. */
    public static List<String> labels() {
        return Arrays.stream(values()).map(ClipAspect::label).toList();
    }

    /** The shape with that label, or empty when there is none. */
    public static Optional<ClipAspect> find(String label) {
        return Arrays.stream(values()).filter(aspect -> aspect.label.equals(label)).findFirst();
    }

    /** @throws IllegalArgumentException when the label is not the label of any shape */
    @JsonCreator
    public static ClipAspect fromLabel(String label) {
        return find(label).orElseThrow(() -> new IllegalArgumentException("Unknown aspect '" + label + "'; expected "
                + labels()));
    }
}
