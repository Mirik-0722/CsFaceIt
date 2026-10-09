package io.csfaceit.backend.demo;

import com.github.luben.zstd.ZstdOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.GZIPInputStream;
import org.springframework.util.unit.DataSize;

/**
 * The temporary files of a demo on its way into storage, shared by the download ({@link DemoDownloader}) and the
 * manual upload ({@link DemoService}): a bounded copy, and the normalization of any demo to zstd. Nothing is held in
 * memory beyond a copy buffer, nothing is trusted about the size a sender announces, and a method that fails deletes
 * the files it created.
 */
final class DemoFiles {

    private static final int BUFFER_SIZE = 64 * 1024;
    private static final int ZSTD_LEVEL = 3;

    private static final byte[] GZIP_MAGIC = {0x1f, (byte) 0x8b};
    private static final byte[] ZSTD_MAGIC = {0x28, (byte) 0xb5, 0x2f, (byte) 0xfd};

    private DemoFiles() {
    }

    /**
     * Creates an empty temporary file in the system temp directory; the caller deletes it.
     *
     * @throws DemoDownloadException the file could not be created
     */
    static Path createTempFile() {
        try {
            return Files.createTempFile("demo-", ".part");
        } catch (IOException e) {
            throw new DemoDownloadException("A temporary file for the demo could not be created", e);
        }
    }

    static void deleteQuietly(Path file) {
        if (file == null) {
            return;
        }
        try {
            Files.deleteIfExists(file);
        } catch (IOException ignored) {
            // Nothing more can be done about a file that cannot be deleted; the OS cleans the temp directory.
        }
    }

    /**
     * Copies {@code in} to a new temporary file and returns it; the caller deletes it. At most {@code limit} bytes
     * are accepted, counted as they arrive.
     *
     * @throws DemoDownloadRejectedException the stream is larger than {@code limit}
     * @throws DemoDownloadException the stream could not be read or the file not be written
     */
    static Path receive(InputStream in, DataSize limit) {
        Path file = createTempFile();
        boolean done = false;
        try {
            try (OutputStream out = Files.newOutputStream(file)) {
                copyBounded(in, out, limit);
            }
            done = true;
            return file;
        } catch (IOException e) {
            throw new DemoDownloadException("The received demo could not be written to a temporary file", e);
        } finally {
            if (!done) {
                deleteQuietly(file);
            }
        }
    }

    /**
     * Brings a demo file to zstd, by its first bytes and not by its name: zstd is kept as it is, gzip is unpacked and
     * compressed again, anything else is taken for a raw demo and compressed. The result is either {@code source}
     * itself or a new temporary file, in which case {@code source} is deleted; when this method fails, {@code source}
     * is left for the caller to delete. A demo that expands beyond {@code limit} is refused.
     *
     * @return the zstd file; the caller deletes it
     * @throws DemoDownloadRejectedException the demo is larger than {@code limit}
     * @throws DemoDownloadException the file could not be read or compressed (a corrupt gzip file is the
     *         {@link java.util.zip.ZipException} or {@link java.io.EOFException} cause)
     */
    static Path normalize(Path source, DataSize limit) {
        try {
            byte[] head = readHead(source);
            if (startsWith(head, ZSTD_MAGIC)) {
                return source;
            }
            boolean gzip = startsWith(head, GZIP_MAGIC);
            Path target = createTempFile();
            boolean done = false;
            try {
                try (InputStream file = Files.newInputStream(source);
                     InputStream in = gzip ? new GZIPInputStream(file, BUFFER_SIZE) : file;
                     OutputStream targetFile = Files.newOutputStream(target);
                     OutputStream out = new ZstdOutputStream(targetFile, ZSTD_LEVEL)) {
                    copyBounded(in, out, limit);
                }
                // Only after the streams are closed: closing the zstd stream writes the end of the frame and can fail.
                done = true;
            } finally {
                // Also for an Error, such as the failure to load the native zstd library.
                if (!done) {
                    deleteQuietly(target);
                }
            }
            deleteQuietly(source);
            return target;
        } catch (IOException e) {
            throw new DemoDownloadException("The demo file could not be compressed", e);
        }
    }

    /** Copies at most {@code limit} bytes, counting what really arrives instead of believing a length header. */
    static long copyBounded(InputStream in, OutputStream out, DataSize limit) throws IOException {
        long max = limit.toBytes();
        byte[] buffer = new byte[BUFFER_SIZE];
        long total = 0;
        int read;
        while ((read = in.read(buffer)) != -1) {
            total += read;
            if (total > max) {
                throw tooLarge(limit);
            }
            out.write(buffer, 0, read);
        }
        return total;
    }

    static DemoDownloadRejectedException tooLarge(DataSize limit) {
        return new DemoDownloadRejectedException(
                "Demo download rejected: the file is larger than the allowed " + describe(limit) + ".");
    }

    /** "1 GB", "512 MB", "2 KB" or "700 bytes": the largest unit that divides the size exactly. */
    private static String describe(DataSize size) {
        long bytes = size.toBytes();
        String[] names = {"GB", "MB", "KB"};
        DataSize[] units = {DataSize.ofGigabytes(1), DataSize.ofMegabytes(1), DataSize.ofKilobytes(1)};
        for (int i = 0; i < units.length; i++) {
            long unit = units[i].toBytes();
            if (bytes >= unit && bytes % unit == 0) {
                return bytes / unit + " " + names[i];
            }
        }
        return bytes + " bytes";
    }

    private static byte[] readHead(Path file) throws IOException {
        try (InputStream in = Files.newInputStream(file)) {
            return in.readNBytes(ZSTD_MAGIC.length);
        }
    }

    private static boolean startsWith(byte[] bytes, byte[] prefix) {
        if (bytes.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (bytes[i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }
}
