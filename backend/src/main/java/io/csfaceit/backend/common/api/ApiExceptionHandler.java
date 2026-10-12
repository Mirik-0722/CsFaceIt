package io.csfaceit.backend.common.api;

import io.csfaceit.backend.faceit.FaceitNotFoundException;
import io.csfaceit.backend.faceit.FaceitUnavailableException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Path;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.TypeMismatchException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.client.RestClientException;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * Turns every exception into an {@link ApiError}. Spring MVC's own exceptions (missing parameter, unmapped path,
 * wrong method, ...) keep the HTTP status Spring gives them; everything unexpected becomes a 500 whose body carries
 * no internal detail.
 */
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    static final String VALIDATION_ERROR = "VALIDATION_ERROR";
    static final String INTERNAL_ERROR = "INTERNAL_ERROR";
    static final String NOT_FOUND = "NOT_FOUND";
    static final String FACEIT_UNAVAILABLE = "FACEIT_UNAVAILABLE";
    static final String PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";

    private static final String FACEIT_UNAVAILABLE_MESSAGE = "FACEIT is unavailable";
    private static final String INTERNAL_ERROR_MESSAGE = "Unexpected server error";

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(NotFoundException.class)
    ResponseEntity<ApiError> handleNotFound(NotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiError(ex.getCode(), ex.getMessage()));
    }

    @ExceptionHandler(BadRequestException.class)
    ResponseEntity<ApiError> handleBadRequest(BadRequestException ex) {
        return ResponseEntity.badRequest().body(new ApiError(VALIDATION_ERROR, ex.getMessage()));
    }

    @ExceptionHandler(ConflictException.class)
    ResponseEntity<ApiError> handleConflict(ConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiError(ex.getCode(), ex.getMessage()));
    }

    @ExceptionHandler(TooManyRequestsException.class)
    ResponseEntity<ApiError> handleTooManyRequests(TooManyRequestsException ex) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(new ApiError(ex.getCode(), ex.getMessage()));
    }

    /** Safety net: services translate this into a {@link NotFoundException} with a context-specific code. */
    @ExceptionHandler(FaceitNotFoundException.class)
    ResponseEntity<ApiError> handleFaceitNotFound(FaceitNotFoundException ex) {
        log.warn("A FACEIT 404 reached the API layer untranslated: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiError(NOT_FOUND, "Resource not found"));
    }

    @ExceptionHandler(FaceitUnavailableException.class)
    ResponseEntity<ApiError> handleFaceitUnavailable(FaceitUnavailableException ex) {
        log.warn("FACEIT is unavailable: {}", ex.getMessage());
        return badGateway();
    }

    /** Anything the REST client throws on its own: an unparseable body or an unexpected 4xx from FACEIT. */
    @ExceptionHandler(RestClientException.class)
    ResponseEntity<ApiError> handleRestClient(RestClientException ex) {
        log.error("FACEIT returned an unusable response", ex);
        return badGateway();
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ApiError> handleConstraintViolation(ConstraintViolationException ex) {
        String message = ex.getConstraintViolations().stream()
                .map(violation -> lastNode(violation) + " " + violation.getMessage())
                .sorted()
                .collect(Collectors.joining("; "));
        return ResponseEntity.badRequest().body(new ApiError(VALIDATION_ERROR, message));
    }

    /**
     * A multipart request that cannot be read: a body that is not well-formed multipart, or an upload the client
     * cancelled half way. Spring wraps what Tomcat throws in a {@link MultipartException}; it is the client's doing,
     * so it is a 400 and a WARN line without a stack trace. An upload that is too large is the subclass
     * {@link MaxUploadSizeExceededException}, which keeps its own 413 answer: of the handlers that fit, Spring uses the
     * one for the closest exception type, and that is {@link #handleMaxUploadSizeExceededException}.
     */
    @ExceptionHandler(MultipartException.class)
    ResponseEntity<ApiError> handleMultipart(MultipartException ex) {
        log.warn("Rejecting a malformed or aborted multipart request: {}", ex.getMessage());
        return ResponseEntity.badRequest()
                .body(new ApiError(VALIDATION_ERROR, "The multipart request could not be read"));
    }

    /**
     * Spring Security's own filters turn these into 401/403, but only if they reach them: the catch-all below would
     * answer 500. Rethrowing the very same exception makes MVC skip its handlers and let it propagate, silently.
     */
    @ExceptionHandler({AccessDeniedException.class, AuthenticationException.class})
    void rethrowSecurityException(RuntimeException ex) {
        throw ex;
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ApiError(INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE));
    }

    @Override
    protected ResponseEntity<Object> handleMissingServletRequestParameter(MissingServletRequestParameterException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        return handleExceptionInternal(ex,
                new ApiError(VALIDATION_ERROR, "Required parameter '" + ex.getParameterName() + "' is missing"),
                headers, status, request);
    }

    @Override
    protected ResponseEntity<Object> handleMissingServletRequestPart(MissingServletRequestPartException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        return handleExceptionInternal(ex,
                new ApiError(VALIDATION_ERROR, "Required part '" + ex.getRequestPartName() + "' is missing"),
                headers, status, request);
    }

    /**
     * An upload larger than {@code spring.servlet.multipart.max-file-size} or {@code max-request-size}: Tomcat
     * stops reading it and Spring raises this, so it is answered here instead of with Tomcat's error page or a 500.
     * Also raised by the demo upload itself, when a gzip file expands beyond the allowed size.
     */
    @Override
    protected ResponseEntity<Object> handleMaxUploadSizeExceededException(MaxUploadSizeExceededException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        return handleExceptionInternal(ex,
                new ApiError(PAYLOAD_TOO_LARGE, "The uploaded file is larger than the allowed size"),
                headers, HttpStatus.PAYLOAD_TOO_LARGE, request);
    }

    @Override
    protected ResponseEntity<Object> handleTypeMismatch(TypeMismatchException ex, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        return handleExceptionInternal(ex,
                new ApiError(VALIDATION_ERROR, "Parameter '" + ex.getPropertyName() + "' has an invalid value"),
                headers, status, request);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map((FieldError error) -> error.getField() + " " + error.getDefaultMessage())
                .sorted()
                .collect(Collectors.joining("; "));
        return handleExceptionInternal(ex, new ApiError(VALIDATION_ERROR, message), headers, status, request);
    }

    @Override
    protected ResponseEntity<Object> handleHandlerMethodValidationException(HandlerMethodValidationException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        String message = ex.getParameterValidationResults().stream()
                .flatMap(result -> result.getResolvableErrors().stream()
                        .map(error -> result.getMethodParameter().getParameterName() + " " + error.getDefaultMessage()))
                .sorted()
                .collect(Collectors.joining("; "));
        return handleExceptionInternal(ex, new ApiError(VALIDATION_ERROR, message), headers, status, request);
    }

    /**
     * Single exit for every exception Spring MVC handles itself: an {@link ApiError} replaces Spring's
     * {@code ProblemDetail}, and the status is kept. Server-side (5xx) failures are logged and lose their detail.
     */
    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, @Nullable Object body, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        ApiError error;
        if (status.is5xxServerError()) {
            log.error("Request failed with HTTP {}", status.value(), ex);
            error = new ApiError(status.value() == 500 ? INTERNAL_ERROR : codeFor(status), INTERNAL_ERROR_MESSAGE);
        } else if (body instanceof ApiError apiError) {
            error = apiError;
        } else {
            error = new ApiError(codeFor(status), messageFor(status));
        }
        return super.handleExceptionInternal(ex, error, headers, status, request);
    }

    private static ResponseEntity<ApiError> badGateway() {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(new ApiError(FACEIT_UNAVAILABLE, FACEIT_UNAVAILABLE_MESSAGE));
    }

    /** 400 is always a validation problem; other statuses use their standard name (404 NOT_FOUND, 405 ...). */
    private static String codeFor(HttpStatusCode status) {
        if (status.value() == 400) {
            return VALIDATION_ERROR;
        }
        HttpStatus resolved = HttpStatus.resolve(status.value());
        return resolved == null ? "ERROR" : resolved.name();
    }

    private static String messageFor(HttpStatusCode status) {
        if (status.value() == 400) {
            return "Invalid request";
        }
        HttpStatus resolved = HttpStatus.resolve(status.value());
        return resolved == null ? "Request failed" : resolved.getReasonPhrase();
    }

    /** The parameter name of a violation: the last node of {@code methodName.parameterName}. */
    private static String lastNode(ConstraintViolation<?> violation) {
        String name = null;
        for (Path.Node node : violation.getPropertyPath()) {
            name = node.getName();
        }
        return name == null ? "request" : name;
    }
}
