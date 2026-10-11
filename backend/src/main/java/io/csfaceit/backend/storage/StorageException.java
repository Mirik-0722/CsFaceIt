package io.csfaceit.backend.storage;

/** The storage could not read, write, list or delete an object, or was given a key it refuses. */
public class StorageException extends RuntimeException {

    public StorageException(String message) {
        super(message);
    }

    public StorageException(String message, Throwable cause) {
        super(message, cause);
    }
}
