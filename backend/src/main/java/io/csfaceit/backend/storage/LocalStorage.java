package io.csfaceit.backend.storage;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;

/**
 * Keeps the objects as files under one directory, for development. The directory and the folders below it are
 * created when something is first stored, so a backend that never stores anything touches no disk.
 */
public class LocalStorage implements StorageService {

    /** Suffix of the file an upload is written to before it is moved into place; listings skip such files. */
    private static final String TEMP_SUFFIX = ".tmp";

    private final Path root;

    public LocalStorage(String localDir) {
        this.root = Path.of(localDir).toAbsolutePath().normalize();
    }

    /**
     * Copies {@code file} next to its destination and moves the copy into place in one step, so a reader sees the
     * old object or the whole new one and a crash leaves at worst a stray {@code .tmp} file.
     */
    @Override
    public void put(String key, Path file) {
        Path target = resolve(key);
        Path temp = target.resolveSibling("." + target.getFileName() + "." + UUID.randomUUID() + TEMP_SUFFIX);
        try {
            Files.createDirectories(target.getParent());
            Files.copy(file, temp, StandardCopyOption.REPLACE_EXISTING);
            Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new StorageException("Could not store " + key, e);
        } finally {
            deleteQuietly(temp);
        }
    }

    @Override
    public InputStream get(String key) {
        try {
            return Files.newInputStream(resolve(key));
        } catch (NoSuchFileException e) {
            throw new StorageException("No such object: " + key, e);
        } catch (IOException e) {
            throw new StorageException("Could not read " + key, e);
        }
    }

    @Override
    public boolean exists(String key) {
        return Files.isRegularFile(resolve(key));
    }

    @Override
    public void delete(String key) {
        try {
            Files.deleteIfExists(resolve(key));
        } catch (IOException e) {
            throw new StorageException("Could not delete " + key, e);
        }
    }

    @Override
    public List<String> listOlderThan(String prefix, Instant cutoff) {
        StorageKeys.requireValidPrefix(prefix);
        // Only the folder the prefix names (up to its last slash) can hold matching files.
        int lastSlash = prefix.lastIndexOf('/');
        Path start = lastSlash < 0 ? root : resolve(prefix.substring(0, lastSlash));
        if (!Files.isDirectory(start)) {
            return List.of();
        }
        List<String> keys = new ArrayList<>();
        try (Stream<Path> files = Files.walk(start)) {
            for (Path file : (Iterable<Path>) files::iterator) {
                if (!Files.isRegularFile(file) || file.getFileName().toString().endsWith(TEMP_SUFFIX)) {
                    continue;
                }
                String key = root.relativize(file).toString().replace(file.getFileSystem().getSeparator(), "/");
                if (key.startsWith(prefix) && Files.getLastModifiedTime(file).toInstant().isBefore(cutoff)) {
                    keys.add(key);
                }
            }
        } catch (IOException e) {
            throw new StorageException("Could not list " + prefix, e);
        }
        return keys;
    }

    /** The file a key names; a key that is not valid, or that would lead outside the root, is refused. */
    private Path resolve(String key) {
        Path path = root.resolve(StorageKeys.requireValid(key)).normalize();
        if (!path.startsWith(root) || path.equals(root)) {
            throw new StorageException("Storage key leaves the storage directory: " + key);
        }
        return path;
    }

    private static void deleteQuietly(Path file) {
        try {
            Files.deleteIfExists(file);
        } catch (IOException ignored) {
            // A stray temp file is harmless and skipped by listings.
        }
    }
}
