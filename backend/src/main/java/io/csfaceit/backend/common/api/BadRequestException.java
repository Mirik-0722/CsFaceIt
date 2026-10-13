package io.csfaceit.backend.common.api;

/**
 * The request itself is wrong (a file of the wrong kind, a part that is missing); the answer is 400 with {@code code},
 * which is {@code VALIDATION_ERROR} unless the request is wrong in a way a client tells apart (a demo link that is
 * refused, for example).
 */
public class BadRequestException extends RuntimeException {

    private final String code;

    public BadRequestException(String message) {
        this(ApiExceptionHandler.VALIDATION_ERROR, message);
    }

    public BadRequestException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
