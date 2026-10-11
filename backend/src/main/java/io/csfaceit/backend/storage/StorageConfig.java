package io.csfaceit.backend.storage;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class StorageConfig {

    static final String TYPE_LOCAL = "local";
    static final String TYPE_MINIO = "minio";

    /**
     * The one storage the application uses, chosen by {@code storage.type}; the other implementation is not even
     * constructed. An unknown type stops the startup with a message that names the allowed ones.
     */
    @Bean
    StorageService storageService(StorageProperties properties) {
        String type = properties.type() == null ? "" : properties.type().trim();
        return switch (type) {
            case TYPE_LOCAL -> new LocalStorage(properties.localDir());
            case TYPE_MINIO -> new MinioStorage(properties.minio());
            default -> throw new IllegalStateException(
                    "storage.type must be '" + TYPE_LOCAL + "' or '" + TYPE_MINIO + "', not '" + properties.type() + "'");
        };
    }
}
