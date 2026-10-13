package io.csfaceit.backend.demo;

import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Binds the {@code demo.link.*} block of {@code application.yml}: where a demo link that a player pastes may lead
 * ({@link LinkGuard}) and how long its download may take.
 *
 * @param allowedOrigins the origins a pasted link and every redirect of it may lead to, each {@code scheme://host} or
 *        {@code scheme://host:port}; the host is a name, either exact or {@code *.} followed by a domain, which stands for
 *        any name under that domain. Empty: no link is accepted.
 * @param privateHosts exact host names whose addresses are not required to be public. Only for the stack with the fake
 *        FACEIT, which lives on a private network; empty everywhere else.
 * @param maxDuration the longest a whole download from a link may take, redirects included
 */
@Validated
@ConfigurationProperties(prefix = "demo.link")
public record DemoLinkProperties(List<String> allowedOrigins, List<String> privateHosts, @NotNull Duration maxDuration) {

    public DemoLinkProperties {
        allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
        privateHosts = privateHosts == null ? List.of() : List.copyOf(privateHosts);
    }
}
