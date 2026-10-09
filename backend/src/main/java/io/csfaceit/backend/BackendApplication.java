package io.csfaceit.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.retry.annotation.EnableRetry;
import org.springframework.scheduling.annotation.EnableScheduling;

// Authentication is by API key only; without this Boot would add a user with a password generated at startup.
@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
@EnableRetry
// For the daily clean-up of old demo files (demo/DemoRetentionJob); nothing else is scheduled.
@EnableScheduling
@ConfigurationPropertiesScan
public class BackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(BackendApplication.class, args);
    }
}
