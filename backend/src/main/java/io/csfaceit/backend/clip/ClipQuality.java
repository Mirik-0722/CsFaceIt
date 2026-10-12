package io.csfaceit.backend.clip;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.persistence.AttributeConverter;
import java.util.Arrays;

/**
 * The size a clip is recorded at. In JSON and in {@code clips.quality} a quality is its {@link #label}, {@code "720p"}
 * or {@code "1080p"}, not the name of the constant; a label that is none of them is rejected when the request body is
 * read.
 */
public enum ClipQuality {
    P720("720p", 1280, 720),
    P1080("1080p", 1920, 1080);

    private final String label;
    private final int width;
    private final int height;

    ClipQuality(String label, int width, int height) {
        this.label = label;
        this.width = width;
        this.height = height;
    }

    @JsonValue
    public String label() {
        return label;
    }

    /** The width of the picture a recorder is asked for. */
    public int width() {
        return width;
    }

    /** The height of the picture a recorder is asked for. */
    public int height() {
        return height;
    }

    /** @throws IllegalArgumentException when the label is not the label of any quality */
    @JsonCreator
    public static ClipQuality fromLabel(String label) {
        return Arrays.stream(values())
                .filter(quality -> quality.label.equals(label))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unknown quality '" + label + "'; expected "
                        + Arrays.stream(values()).map(ClipQuality::label).toList()));
    }

    /** Stores a quality in {@code clips.quality} as its label; {@code Clip} names it on the column. */
    @jakarta.persistence.Converter
    public static class ColumnConverter implements AttributeConverter<ClipQuality, String> {

        @Override
        public String convertToDatabaseColumn(ClipQuality quality) {
            return quality == null ? null : quality.label;
        }

        @Override
        public ClipQuality convertToEntityAttribute(String label) {
            return label == null ? null : fromLabel(label);
        }
    }
}
