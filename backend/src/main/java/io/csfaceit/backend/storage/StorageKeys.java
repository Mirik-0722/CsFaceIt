package io.csfaceit.backend.storage;

/** The rules every {@link StorageService} applies to the keys it is given. */
final class StorageKeys {

    private StorageKeys() {
    }

    /**
     * A key must be a relative path of non-empty segments, none of them {@code .} or {@code ..}, without backslashes
     * or control characters: whatever the storage does with it, it cannot name anything outside its own root.
     *
     * @return the key, for use in an expression
     */
    static String requireValid(String key) {
        if (key == null || key.isEmpty()) {
            throw new StorageException("The storage key must not be empty");
        }
        if (key.startsWith("/") || key.indexOf('\\') >= 0 || containsControlCharacter(key)) {
            throw new StorageException("Invalid storage key: " + printable(key));
        }
        for (String segment : key.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) {
                throw new StorageException("Invalid storage key: " + printable(key));
            }
        }
        return key;
    }

    /**
     * A prefix is a key that may also be empty (everything) or end in a slash (a folder). Validated like a key
     * otherwise.
     */
    static String requireValidPrefix(String prefix) {
        if (prefix == null) {
            throw new StorageException("The storage prefix must not be null");
        }
        if (prefix.isEmpty()) {
            return prefix;
        }
        requireValid(prefix.endsWith("/") ? prefix.substring(0, prefix.length() - 1) : prefix);
        return prefix;
    }

    private static boolean containsControlCharacter(String key) {
        return key.chars().anyMatch(Character::isISOControl);
    }

    /** A key in an error message must not spoil a log line. */
    private static String printable(String key) {
        return key.replaceAll("\\p{Cntrl}", "?");
    }
}
