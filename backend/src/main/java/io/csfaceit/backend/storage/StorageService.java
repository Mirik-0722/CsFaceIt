package io.csfaceit.backend.storage;

import java.io.InputStream;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

/**
 * Where the stored files live: the demos, and the videos and thumbnails of the clips. A key is a relative,
 * slash-separated name such as {@code demos/1-abc.dem.zst}; one that is absolute, empty, or has a {@code .} or
 * {@code ..} segment is refused. Every method throws {@link StorageException} when the storage cannot do what was
 * asked.
 */
public interface StorageService {

    /** Stores the content of {@code file} under {@code key}, replacing what is there. Readers never see a partial object. */
    void put(String key, Path file);

    /** Opens the object for reading; the caller closes the stream. A missing object is a {@link StorageException}. */
    InputStream get(String key);

    /**
     * Opens a stretch of the object: {@code length} bytes from {@code offset}, or fewer when the object ends sooner;
     * the caller closes the stream. This is what answers a {@code Range} request. A missing object is a
     * {@link StorageException}, and so is an {@code offset} at or beyond the end of the object.
     *
     * @throws IllegalArgumentException {@code offset} is negative or {@code length} is not positive
     */
    InputStream get(String key, long offset, long length);

    /** The size of the object in bytes. A missing object is a {@link StorageException}. */
    long size(String key);

    boolean exists(String key);

    /** Removes the object; removing one that is not there is not an error. */
    void delete(String key);

    /** The keys below {@code prefix} that were last modified before {@code cutoff}. */
    List<String> listOlderThan(String prefix, Instant cutoff);
}
