package io.csfaceit.backend.storage;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Binds the {@code storage.*} block of {@code application.yml}. {@code type} is {@code local} (files under
 * {@code localDir}) or {@code minio} (an S3-compatible server described by {@code minio}).
 */
@ConfigurationProperties(prefix = "storage")
public record StorageProperties(String type, String localDir, Minio minio) {

    public record Minio(String endpoint, String accessKey, String secretKey, String bucket) {

        /** Keeps the secret out of logs and exception messages that print the properties. */
        @Override
        public String toString() {
            return "Minio[endpoint=" + endpoint + ", accessKey=" + accessKey + ", secretKey=***, bucket=" + bucket + "]";
        }
    }
}
