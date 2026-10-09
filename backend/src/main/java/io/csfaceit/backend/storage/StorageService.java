package io.csfaceit.backend.storage;

import java.io.InputStream;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

/**
 * Where the demo files live. A key is a relative, slash-separated name such as {@code demos/1-abc.dem.zst}; one that
 * is absolute, empty, or has a {@code .} or {@code ..} segment is refused. Every method throws
 * {@link StorageException} when the storage cannot do what was asked.
 */
public interface StorageService {

    /** Stores the content of {@code file} under {@code key}, replacing what is there. Readers never see a partial object. */
    void put(String key, Path file);

    /** Opens the object for reading; the caller closes the stream. A missing object is a {@link StorageException}. */
    InputStream get(String key);

    boolean exists(String key);

    /** Removes the object; removing one that is not there is not an error. */
    void delete(String key);

    /** The keys below {@code prefix} that were last modified before {@code cutoff}. */
    List<String> listOlderThan(String prefix, Instant cutoff);
}
