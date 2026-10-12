package io.csfaceit.backend.clip.worker.dto;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * The name a recorder gives itself, in the body of a request or in its query: not blank, at most
 * {@link WorkerLimits#NAME} characters, and only the plain characters of {@link WorkerLimits#PLAIN}. Each of the three
 * rules reports for itself, so the answer says which one a name breaks. The name has to be unique among the recorders
 * that run at the same time: the check that a clip is the recorder's rests on it.
 */
@Documented
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = {})
@NotBlank
@Size(max = WorkerLimits.NAME)
@Pattern(regexp = WorkerLimits.PLAIN, message = WorkerLimits.PLAIN_MESSAGE)
public @interface WorkerName {

    String message() default "is not a valid recorder name";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
