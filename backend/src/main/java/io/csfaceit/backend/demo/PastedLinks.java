package io.csfaceit.backend.demo;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * The demo links that players pasted, from the request to the import worker, held in this process's memory for a
 * while. A link can carry a signature, which is a credential, so it does not travel in the {@code demo.import} message:
 * a message that fails is republished to the dead-letter queue with its exception, and the broker keeps and shows what
 * it holds. The request puts the link here before it publishes the message, and the worker takes it from here first.
 *
 * <p>A link that is not taken within {@link #TTL} is dropped. A restart drops all of them: the import of such a demo
 * then goes the way of an import without a link, or the player pastes the link again.
 */
@Component
public class PastedLinks {

    /** How long a link waits for the worker; far longer than the queue ever waits, far shorter than a link lives. */
    static final Duration TTL = Duration.ofMinutes(15);

    private record Entry(URI link, Instant expiresAt) {
    }

    private final Map<Long, Entry> links = new ConcurrentHashMap<>();
    private final Clock clock;

    public PastedLinks(Clock clock) {
        this.clock = clock;
    }

    /** Holds the link for the import of the demo, replacing one held before. */
    public void put(long demoId, URI link) {
        Instant now = clock.instant();
        links.values().removeIf(entry -> entry.expiresAt().isBefore(now));
        links.put(demoId, new Entry(link, now.plus(TTL)));
    }

    /** Removes the link of the demo and gives it, unless there is none or it has expired. */
    public Optional<URI> take(long demoId) {
        Entry entry = links.remove(demoId);
        if (entry == null || entry.expiresAt().isBefore(clock.instant())) {
            return Optional.empty();
        }
        return Optional.of(entry.link());
    }
}
