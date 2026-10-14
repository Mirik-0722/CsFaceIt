package io.csfaceit.backend.demo;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;

/**
 * Binds the {@code demo.upload.*} block of {@code application.yml}. {@code maxSize} is the most a manual upload may
 * be (the same value limits the file and the whole request in {@code spring.servlet.multipart}) and the most a gzip
 * or bzip2 demo may expand to.
 */
@ConfigurationProperties(prefix = "demo.upload")
public record DemoUploadProperties(DataSize maxSize) {
}
