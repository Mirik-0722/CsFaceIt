package io.csfaceit.backend.storage;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
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

    /** The file is positioned through a channel, so a read from the middle of a large file does not read its start. */
    @Override
    public InputStream get(String key, long offset, long length) {
        StorageKeys.requireValidRange(offset, length);
        Path file = resolve(key);
        if (!Files.isRegularFile(file)) {
            throw new StorageException("No such object: " + key);
        }
        FileChannel channel = null;
        try {
            channel = FileChannel.open(file, StandardOpenOption.READ);
            long size = channel.size();
            if (offset >= size) {
                throw new StorageException(
                        "The range of " + key + " starts at " + offset + ", beyond its end at " + size);
            }
            channel.position(offset);
            InputStream range = new LimitedInputStream(Channels.newInputStream(channel),
                    Math.min(length, size - offset));
            channel = null;
            return range;
        } catch (NoSuchFileException e) {
            throw new StorageException("No such object: " + key, e);
        } catch (IOException e) {
            throw new StorageException("Could not read " + key, e);
        } finally {
            closeQuietly(channel);
        }
    }

    @Override
    public long size(String key) {
        Path file = resolve(key);
        if (!Files.isRegularFile(file)) {
            throw new StorageException("No such object: " + key);
        }
        try {
            return Files.size(file);
        } catch (NoSuchFileException e) {
            throw new StorageException("No such object: " + key, e);
        } catch (IOException e) {
            throw new StorageException("Could not look up " + key, e);
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

    private static void closeQuietly(FileChannel channel) {
        if (channel == null) {
            return;
        }
        try {
            channel.close();
        } catch (IOException ignored) {
            // The channel was opened for reading only, so there is nothing to lose with it.
        }
    }

    /** Reads at most {@code remaining} bytes of the stream it wraps; closing it closes the wrapped stream. */
    private static final class LimitedInputStream extends FilterInputStream {

        private long remaining;

        LimitedInputStream(InputStream in, long limit) {
            super(in);
            this.remaining = limit;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) {
                return -1;
            }
            int value = super.read();
            if (value >= 0) {
                remaining--;
            }
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (remaining <= 0) {
                return -1;
            }
            int read = super.read(buffer, offset, (int) Math.min(length, remaining));
            if (read > 0) {
                remaining -= read;
            }
            return read;
        }

        @Override
        public long skip(long count) throws IOException {
            long skipped = super.skip(Math.min(count, remaining));
            remaining -= skipped;
            return skipped;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), remaining);
        }

        @Override
        public boolean markSupported() {
            return false;
        }
    }
}
