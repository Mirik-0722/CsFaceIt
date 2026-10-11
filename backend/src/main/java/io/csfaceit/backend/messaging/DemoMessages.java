package io.csfaceit.backend.messaging;

/**
 * Names and payloads of the demo pipeline's RabbitMQ topology. Messages are JSON with camelCase fields; the Rust
 * parser reads and writes the same shapes, so a field never changes without the parser.
 */
public final class DemoMessages {

    /** Topic exchange; the routing key of a message is the name of the queue it is meant for. */
    public static final String EXCHANGE = "demo";

    /** Demos to download from FACEIT and store. */
    public static final String Q_IMPORT = "demo.import";

    /** Stored demos waiting for the parser. */
    public static final String Q_PARSE = "demo.parse";

    /** Parsed demos waiting for the analysis. */
    public static final String Q_PARSED = "demo.parsed";

    /** Fanout exchange that receives the messages that could not be processed. */
    public static final String DLX = "demo.dlx";

    /** Dead-letter queue bound to {@link #DLX}. */
    public static final String DLQ = "demo.dlq";

    private DemoMessages() {
    }

    /** Published to {@link #Q_IMPORT} once the demo row is committed. */
    public record DemoImportRequested(long demoId, String faceitMatchId, String demoUrl) {
    }

    /** Published to {@link #Q_PARSE} once the demo file is in storage. */
    public record DemoStored(long demoId, String faceitMatchId, String storageKey) {
    }

    /** Published to {@link #Q_PARSED} once the parser has written its facts to the database. */
    public record DemoParsed(long demoId, String faceitMatchId) {
    }
}
