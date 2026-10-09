package io.csfaceit.backend.messaging;

import static io.csfaceit.backend.messaging.DemoMessages.DLQ;
import static io.csfaceit.backend.messaging.DemoMessages.DLX;
import static io.csfaceit.backend.messaging.DemoMessages.EXCHANGE;
import static io.csfaceit.backend.messaging.DemoMessages.Q_IMPORT;
import static io.csfaceit.backend.messaging.DemoMessages.Q_PARSE;
import static io.csfaceit.backend.messaging.DemoMessages.Q_PARSED;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
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

    /** How often a listener tries a message before it is dead-lettered. */
    static final int MAX_ATTEMPTS = 3;
    private static final long INITIAL_BACKOFF_MS = 1_000;
    private static final double BACKOFF_MULTIPLIER = 2.0;
    private static final long MAX_BACKOFF_MS = 10_000;

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
        // Everything is retried (the default value true) except a rejection; traversing the causes finds the
        // rejection inside the ListenerExecutionFailedException that wraps what the listener threw.
        SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy(MAX_ATTEMPTS,
                Map.of(AmqpRejectAndDontRequeueException.class, false), true, true);
        factory.setAdviceChain(RetryInterceptorBuilder.stateless()
                .retryPolicy(retryPolicy)
                .backOffOptions(INITIAL_BACKOFF_MS, BACKOFF_MULTIPLIER, MAX_BACKOFF_MS)
                .recoverer(new RepublishMessageRecoverer(rabbitTemplate, DLX))
                .build());
        return factory;
    }
}
