package io.csfaceit.backend.demo;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;

/**
 * Binds the {@code demo.download.*} block of {@code application.yml}. {@code readTimeout} is the longest silence
 * between two reads of the response, not the length of the whole transfer; {@code maxSize} bounds both what is
 * transferred and what a gzip demo expands to.
 */
@ConfigurationProperties(prefix = "demo.download")
public record DemoDownloadProperties(Duration connectTimeout, Duration readTimeout, DataSize maxSize) {
}
