package io.csfaceit.backend.usage;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.time.Duration;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Binds the {@code limits.*} block of {@code application.yml}: how much a signed-in player may do within a rolling
 * window. The admin key and an administrator are not limited. The application refuses to start with a window or a
 * count that is not positive: a limit of 0 would refuse everybody and have no moment to name at which to try again.
 *
 * @param window the span the actions are counted in, ending now (24 hours by default)
 * @param demoUploads how many demo files a user may upload within the window
 * @param demoImports how many demo imports (and requests for a missing analysis) a user may start within the window
 * @param clipOrders how many clips a user may order within the window, retries of failed clips included
 * @param cs2Links how many times a user may try to link a CS2 account within the window (each attempt that Steam was
 *        asked about counts, refused ones included)
 */
@Validated
@ConfigurationProperties(prefix = "limits")
public record UsageLimits(
        @NotNull @DurationMin(seconds = 1) Duration window,
        @Positive int demoUploads,
        @Positive int demoImports,
        @Positive int clipOrders,
        @Positive int cs2Links) {

    /** The limit of one kind of action. */
    public int of(UsageKind kind) {
        return switch (kind) {
            case DEMO_UPLOAD -> demoUploads;
            case DEMO_IMPORT -> demoImports;
            case CLIP_ORDER -> clipOrders;
            case CS2_LINK -> cs2Links;
        };
    }
}
