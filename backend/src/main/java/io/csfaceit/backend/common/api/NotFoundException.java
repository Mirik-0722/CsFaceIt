package io.csfaceit.backend.common.api;

/** A requested resource does not exist; {@code code} says which one (for example {@code PLAYER_NOT_FOUND}). */
public class NotFoundException extends RuntimeException {

    private final String code;

    public NotFoundException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
