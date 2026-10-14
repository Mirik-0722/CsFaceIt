package io.csfaceit.backend.demo;

import com.github.luben.zstd.ZstdOutputStream;
import java.io.BufferedInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.GZIPInputStream;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;
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
    /** {@code BZh}: the start of every bzip2 stream, the form Valve's replay servers give a matchmaking demo in. */
    private static final byte[] BZIP2_MAGIC = {'B', 'Z', 'h'};

    private DemoFiles() {
    }

    /**
     * A bzip2 file that cannot be unpacked: its blocks are damaged, it is cut off, or something that is no bzip2
     * follows a stream. Told apart from a failure to write the result, which is the server's and no fault of the file.
     */
    static final class CorruptBzip2Exception extends IOException {

        CorruptBzip2Exception(Exception cause) {
            super("The file is not a valid bzip2 archive", cause);
        }
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
     * Brings a demo file to zstd, by its first bytes and not by its name: zstd is kept as it is, gzip and bzip2 are
     * unpacked and compressed again, anything else is taken for a raw demo and compressed. The result is either
     * {@code source} itself or a new temporary file, in which case {@code source} is deleted; when this method fails,
     * {@code source} is left for the caller to delete. A demo that expands beyond {@code limit} is refused, so a small
     * archive that unpacks to far more (a "bomb") is refused like a large file.
     *
     * @return the zstd file; the caller deletes it
     * @throws DemoDownloadRejectedException the demo is larger than {@code limit}
     * @throws DemoDownloadException the file could not be read or compressed (a corrupt gzip file is the
     *         {@link java.util.zip.ZipException} or {@link java.io.EOFException} cause, a corrupt bzip2 file the
     *         {@link CorruptBzip2Exception} cause)
     */
    static Path normalize(Path source, DataSize limit) {
        try {
            byte[] head = readHead(source);
            if (startsWith(head, ZSTD_MAGIC)) {
                return source;
            }
            boolean gzip = startsWith(head, GZIP_MAGIC);
            boolean bzip2 = startsWith(head, BZIP2_MAGIC);
            Path target = createTempFile();
            boolean done = false;
            try {
                try (InputStream file = Files.newInputStream(source);
                     InputStream in = gzip ? new GZIPInputStream(file, BUFFER_SIZE) : bzip2 ? bzip2(file) : file;
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

    /**
     * Unpacks bzip2, also several streams one after the other (as a parallel compressor writes them). The decoder reads
     * the file a bit at a time, so the file is buffered beneath it. Whatever the decoder fails with, when it starts or
     * while it reads, is a {@link CorruptBzip2Exception}: what is beneath it is a local temporary file, so the failure
     * is the file's, and a decoder of a file from outside must not end the request with anything less plain.
     */
    private static InputStream bzip2(InputStream file) throws IOException {
        BZip2CompressorInputStream decoder;
        try {
            decoder = new BZip2CompressorInputStream(new BufferedInputStream(file, BUFFER_SIZE), true);
        } catch (IOException | RuntimeException e) {
            throw new CorruptBzip2Exception(e);
        }
        return new FilterInputStream(decoder) {
            @Override
            public int read() throws IOException {
                try {
                    return super.read();
                } catch (IOException | RuntimeException e) {
                    throw new CorruptBzip2Exception(e);
                }
            }

            @Override
            public int read(byte[] buffer, int offset, int length) throws IOException {
                try {
                    return super.read(buffer, offset, length);
                } catch (IOException | RuntimeException e) {
                    throw new CorruptBzip2Exception(e);
                }
            }
        };
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
