package io.csfaceit.backend.storage;

import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.ListObjectsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.RemoveObjectArgs;
import io.minio.Result;
import io.minio.StatObjectArgs;
import io.minio.UploadObjectArgs;
import io.minio.errors.ErrorResponseException;
import io.minio.http.HttpUtils;
import io.minio.messages.Item;
import java.io.InputStream;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;

/**
 * Keeps the objects in a bucket of an S3-compatible server (MinIO). The bucket is created when it is missing, at
 * startup if the server answers and otherwise on first use, so an application that starts before MinIO does comes up
 * anyway and recovers by itself.
 */
public class MinioStorage implements StorageService, InitializingBean, AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(MinioStorage.class);

    /** The client's own defaults are 5 minutes, which would hold a startup or a worker on an unreachable server. */
    private static final long CONNECT_TIMEOUT_MS = 5_000;
    private static final long TRANSFER_TIMEOUT_MS = 120_000;

    /** What every object is stored as unless its key says otherwise: a demo, compressed with zstd. */
    private static final String DEMO_CONTENT_TYPE = "application/zstd";

    /** Error codes of a missing object, as MinIO and other S3 servers report them. */
    private static final Set<String> NO_SUCH_OBJECT = Set.of("NoSuchKey", "NoSuchObject", "NotFound");

    /** Error codes of a bucket that another caller created while this one was about to. */
    private static final Set<String> BUCKET_EXISTS = Set.of("BucketAlreadyOwnedByYou", "BucketAlreadyExists");

    private final MinioClient client;
    private final String bucket;
    private volatile boolean bucketReady;

    public MinioStorage(StorageProperties.Minio config) {
        this.bucket = config.bucket();
        this.client = MinioClient.builder()
                .endpoint(config.endpoint())
                .credentials(config.accessKey(), config.secretKey())
                .httpClient(HttpUtils.newDefaultHttpClient(CONNECT_TIMEOUT_MS, TRANSFER_TIMEOUT_MS, TRANSFER_TIMEOUT_MS))
                .build();
    }

    @Override
    public void afterPropertiesSet() {
        try {
            ensureBucket();
        } catch (StorageException e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            log.warn("MinIO is not usable at startup; bucket '{}' will be checked again on first use: {}", bucket,
                    cause.toString());
        }
    }

    @Override
    public void put(String key, Path file) {
        StorageKeys.requireValid(key);
        ensureBucket();
        try {
            client.uploadObject(UploadObjectArgs.builder()
                    .bucket(bucket).object(key).filename(file.toString()).contentType(contentTypeOf(key)).build());
        } catch (Exception e) {
            throw new StorageException("Could not store " + key, e);
        }
    }

    @Override
    public InputStream get(String key) {
        StorageKeys.requireValid(key);
        ensureBucket();
        try {
            return client.getObject(GetObjectArgs.builder().bucket(bucket).object(key).build());
        } catch (ErrorResponseException e) {
            throw new StorageException(isMissing(e) ? "No such object: " + key : "Could not read " + key, e);
        } catch (Exception e) {
            throw new StorageException("Could not read " + key, e);
        }
    }

    /** The range is asked of the server ({@code Range: bytes=offset-(offset+length-1)}); only those bytes travel. */
    @Override
    public InputStream get(String key, long offset, long length) {
        StorageKeys.requireValid(key);
        StorageKeys.requireValidRange(offset, length);
        ensureBucket();
        try {
            return client.getObject(GetObjectArgs.builder().bucket(bucket).object(key).offset(offset).length(length)
                    .build());
        } catch (ErrorResponseException e) {
            throw new StorageException(isMissing(e) ? "No such object: " + key : "Could not read " + key, e);
        } catch (Exception e) {
            throw new StorageException("Could not read " + key, e);
        }
    }

    @Override
    public long size(String key) {
        StorageKeys.requireValid(key);
        ensureBucket();
        try {
            return client.statObject(StatObjectArgs.builder().bucket(bucket).object(key).build()).size();
        } catch (ErrorResponseException e) {
            throw new StorageException(isMissing(e) ? "No such object: " + key : "Could not look up " + key, e);
        } catch (Exception e) {
            throw new StorageException("Could not look up " + key, e);
        }
    }

    @Override
    public boolean exists(String key) {
        StorageKeys.requireValid(key);
        ensureBucket();
        try {
            client.statObject(StatObjectArgs.builder().bucket(bucket).object(key).build());
            return true;
        } catch (ErrorResponseException e) {
            if (isMissing(e)) {
                return false;
            }
            throw new StorageException("Could not look up " + key, e);
        } catch (Exception e) {
            throw new StorageException("Could not look up " + key, e);
        }
    }

    @Override
    public void delete(String key) {
        StorageKeys.requireValid(key);
        ensureBucket();
        try {
            client.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(key).build());
        } catch (Exception e) {
            throw new StorageException("Could not delete " + key, e);
        }
    }

    @Override
    public List<String> listOlderThan(String prefix, Instant cutoff) {
        StorageKeys.requireValidPrefix(prefix);
        ensureBucket();
        List<String> keys = new ArrayList<>();
        try {
            for (Result<Item> result : client.listObjects(
                    ListObjectsArgs.builder().bucket(bucket).prefix(prefix).recursive(true).build())) {
                Item item = result.get();
                if (!item.isDir() && item.lastModified() != null && item.lastModified().toInstant().isBefore(cutoff)) {
                    keys.add(item.objectName());
                }
            }
        } catch (Exception e) {
            throw new StorageException("Could not list " + prefix, e);
        }
        return keys;
    }

    @Override
    public void close() throws Exception {
        client.close();
    }

    /** Makes sure the bucket exists; once it has been confirmed this is a flag check. */
    private void ensureBucket() {
        if (bucketReady) {
            return;
        }
        try {
            if (!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
                createBucket();
            }
            bucketReady = true;
        } catch (StorageException e) {
            throw e;
        } catch (Exception e) {
            throw new StorageException("Could not check the bucket '" + bucket + "'", e);
        }
    }

    private void createBucket() throws Exception {
        try {
            client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
            log.info("Created MinIO bucket '{}'", bucket);
        } catch (ErrorResponseException e) {
            if (!BUCKET_EXISTS.contains(code(e))) {
                throw e;
            }
        }
    }

    /** The media type the object is stored with: the files of a clip have their own, the rest are demos. */
    private static String contentTypeOf(String key) {
        if (key.endsWith(".mp4")) {
            return "video/mp4";
        }
        if (key.endsWith(".jpg")) {
            return "image/jpeg";
        }
        return DEMO_CONTENT_TYPE;
    }

    private static boolean isMissing(ErrorResponseException e) {
        return NO_SUCH_OBJECT.contains(code(e));
    }

    private static String code(ErrorResponseException e) {
        return e.errorResponse() == null || e.errorResponse().code() == null ? "" : e.errorResponse().code();
    }
}
