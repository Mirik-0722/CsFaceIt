package io.csfaceit.backend.messaging;

import static io.csfaceit.backend.messaging.DemoMessages.DLQ;
import static io.csfaceit.backend.messaging.DemoMessages.DLX;
import static io.csfaceit.backend.messaging.DemoMessages.EXCHANGE;
import static io.csfaceit.backend.messaging.DemoMessages.Q_IMPORT;
import static io.csfaceit.backend.messaging.DemoMessages.Q_PARSE;
import static io.csfaceit.backend.messaging.DemoMessages.Q_PARSED;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.config.RetryInterceptorBuilder;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.retry.MessageRecoverer;
import org.springframework.amqp.rabbit.retry.RepublishMessageRecoverer;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.boot.autoconfigure.amqp.SimpleRabbitListenerContainerFactoryConfigurer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.retry.policy.SimpleRetryPolicy;

/**
 * The RabbitMQ topology of the demo pipeline, the JSON message format and the failure handling of listeners.
 *
 * <p>Spring Boot's {@code RabbitAdmin} declares everything below when the first connection to the broker is made,
 * so the application starts without a broker and the topology appears as soon as one is reachable.
 */
@Configuration(proxyBeanMethods = false)
public class RabbitConfig {

    /** Name of the container factory of the dead-letter listener; see {@link #dlqListenerContainerFactory}. */
    static final String DLQ_LISTENER_CONTAINER_FACTORY = "dlqListenerContainerFactory";

    /** How often a listener tries a message before it is dead-lettered. */
    static final int MAX_ATTEMPTS = 3;
    private static final long INITIAL_BACKOFF_MS = 1_000;
    private static final double BACKOFF_MULTIPLIER = 2.0;
    private static final long MAX_BACKOFF_MS = 10_000;

    private static final Logger log = LoggerFactory.getLogger(RabbitConfig.class);

    /**
     * Topic exchange {@code demo} with the queues {@code demo.import}, {@code demo.parse} and {@code demo.parsed}
     * (routing key = queue name), all durable. A queue dead-letters into the fanout exchange {@code demo.dlx},
     * which feeds the queue {@code demo.dlq}.
     */
    @Bean
    Declarables demoTopology() {
        TopicExchange demo = new TopicExchange(EXCHANGE, true, false);
        FanoutExchange deadLetters = new FanoutExchange(DLX, true, false);
        Queue dlq = QueueBuilder.durable(DLQ).build();

        Queue importQueue = withDeadLetters(Q_IMPORT);
        Queue parseQueue = withDeadLetters(Q_PARSE);
        Queue parsedQueue = withDeadLetters(Q_PARSED);

        return new Declarables(demo, deadLetters, dlq, importQueue, parseQueue, parsedQueue,
                bind(importQueue, demo), bind(parseQueue, demo), bind(parsedQueue, demo),
                BindingBuilder.bind(dlq).to(deadLetters));
    }

    private static Queue withDeadLetters(String name) {
        return QueueBuilder.durable(name).deadLetterExchange(DLX).build();
    }

    private static Binding bind(Queue queue, TopicExchange exchange) {
        return BindingBuilder.bind(queue).to(exchange).with(queue.getName());
    }

    /**
     * JSON in both directions. Only the message records of this package may be named in a type header, and the
     * Rust parser, which sends no such header, is understood too: a listener's parameter type decides.
     */
    @Bean
    MessageConverter messageConverter(ObjectMapper mapper) {
        return new Jackson2JsonMessageConverter(mapper, DemoMessages.class.getPackageName());
    }

    /**
     * Listeners get three attempts one second apart (the gap doubles). A message that still fails is republished
     * to {@code demo.dlx} with the exception text in its headers, and the original is acknowledged. A listener that
     * throws {@link AmqpRejectAndDontRequeueException} says that another attempt cannot help, so that message is
     * republished at once; the check looks through the wrapper Spring puts around a listener's exception. A message
     * that is rejected outright (an unreadable body) is not requeued, so the queue's own dead-letter setting sends it
     * to {@code demo.dlq} too. The settings under {@code spring.rabbitmq.listener.simple} still apply.
     */
    @Bean
    SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
            SimpleRabbitListenerContainerFactoryConfigurer configurer, ConnectionFactory connectionFactory,
            RabbitTemplate rabbitTemplate) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        configurer.configure(factory, connectionFactory);
        factory.setDefaultRequeueRejected(false);
        // Everything is retried (the default value true) except a rejection and an Error (a native library that
        // failed to load, an out of memory: another attempt cannot help and the JVM is not in a state to retry);
        // traversing the causes finds them inside the ListenerExecutionFailedException that wraps what the listener
        // threw.
        SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy(MAX_ATTEMPTS,
                Map.of(AmqpRejectAndDontRequeueException.class, false, Error.class, false), true, true);
        factory.setAdviceChain(RetryInterceptorBuilder.stateless()
                .retryPolicy(retryPolicy)
                .backOffOptions(INITIAL_BACKOFF_MS, BACKOFF_MULTIPLIER, MAX_BACKOFF_MS)
                .recoverer(new RepublishMessageRecoverer(rabbitTemplate, DLX))
                .build());
        return factory;
    }

    /**
     * The container factory of the listener on {@code demo.dlq}. It retries like the factory above but has no
     * republishing recoverer: a dead letter that cannot be processed
     * (the database is down, say) must not be sent to {@code demo.dlx} again, which would put it straight back into
     * {@code demo.dlq} with a longer routing key, round and round. After {@link #MAX_ATTEMPTS} attempts it is logged
     * at ERROR and rejected without requeue; {@code demo.dlq} has no dead-letter exchange of its own, so the broker
     * drops it.
     */
    @Bean(DLQ_LISTENER_CONTAINER_FACTORY)
    SimpleRabbitListenerContainerFactory dlqListenerContainerFactory(
            SimpleRabbitListenerContainerFactoryConfigurer configurer, ConnectionFactory connectionFactory,
            ObjectMapper mapper) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        configurer.configure(factory, connectionFactory);
        factory.setDefaultRequeueRejected(false);
        SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy(MAX_ATTEMPTS,
                Map.of(AmqpRejectAndDontRequeueException.class, false, Error.class, false), true, true);
        factory.setAdviceChain(RetryInterceptorBuilder.stateless()
                .retryPolicy(retryPolicy)
                .backOffOptions(INITIAL_BACKOFF_MS, BACKOFF_MULTIPLIER, MAX_BACKOFF_MS)
                .recoverer(dropAndLog(mapper))
                .build());
        return factory;
    }

    /** What is left of a dead letter that could not be processed: an ERROR in the log, and a rejection. */
    private static MessageRecoverer dropAndLog(ObjectMapper mapper) {
        return (message, cause) -> {
            log.error("Dropping a dead-lettered message for demo {} from {}: it could not be processed ({}); the demo "
                            + "keeps the status it has", DemoDlqListener.readDemoId(mapper, message),
                    DemoDlqListener.originQueue(message), cause.toString(), cause);
            throw new AmqpRejectAndDontRequeueException("The dead-lettered message could not be processed", cause);
        };
    }
}
