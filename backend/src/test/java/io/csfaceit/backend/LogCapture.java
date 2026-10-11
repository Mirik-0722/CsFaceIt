package io.csfaceit.backend;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.util.List;
import org.slf4j.LoggerFactory;

/**
 * Collects the events one logger emits, for the duration of a try-with-resources block, and keeps them off the
 * console: a test that provokes an expected ERROR (with its stack trace) stays quiet, yet can still assert on it.
 */
public final class LogCapture implements AutoCloseable {

    private final Logger logger;
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();
    private final boolean wasAdditive;

    private LogCapture(String loggerName) {
        this.logger = (Logger) LoggerFactory.getLogger(loggerName);
        this.wasAdditive = logger.isAdditive();
        appender.start();
        logger.addAppender(appender);
        logger.setAdditive(false);
    }

    public static LogCapture of(Class<?> source) {
        return new LogCapture(source.getName());
    }

    public static LogCapture of(String loggerName) {
        return new LogCapture(loggerName);
    }

    public List<ILoggingEvent> events() {
        return List.copyOf(appender.list);
    }

    public List<ILoggingEvent> events(Level level) {
        return appender.list.stream().filter(event -> event.getLevel() == level).toList();
    }

    @Override
    public void close() {
        logger.detachAppender(appender);
        logger.setAdditive(wasAdditive);
        appender.stop();
    }
}
