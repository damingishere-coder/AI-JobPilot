package com.getjobs.application.service;

import com.getjobs.application.mapper.AiMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith({MockitoExtension.class, OutputCaptureExtension.class})
class AiServiceRemoteHttpTest {
    @Mock
    private ConfigService configService;
    @Mock
    private AiMapper aiMapper;
    @Mock
    private ProfileService profileService;
    @Mock
    private CodexCliService codexCliService;

    private HttpServer server;
    private ExecutorService serverExecutor;
    private AiService service;
    private String baseUrl;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        serverExecutor = Executors.newCachedThreadPool();
        server.setExecutor(serverExecutor);
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        service = new AiService(configService, aiMapper, profileService, codexCliService);
    }

    @AfterEach
    void tearDown() {
        if (server != null) server.stop(0);
        if (serverExecutor != null) serverExecutor.shutdownNow();
    }

    @Test
    void returnsStrictChatContentAndForwardsClientRequestId() {
        List<String> requestIds = new CopyOnWriteArrayList<>();
        server.createContext("/v1/chat/completions", exchange -> {
            requestIds.add(exchange.getRequestHeaders().getFirst("X-Request-ID"));
            respond(exchange, 200,
                    "{\"id\":\"provider-1\",\"model\":\"test-model\",\"choices\":[{\"message\":{\"content\":\"provider-ok\"}}]}");
        });
        configure("deepseek-chat", "2");

        assertThat(service.sendRequest("hello")).isEqualTo("provider-ok");
        assertThat(requestIds).hasSize(1);
        assertThat(requestIds.getFirst()).isNotBlank();
    }

    @Test
    void retriesRateLimitOnceWithSameRequestId() {
        AtomicInteger calls = new AtomicInteger();
        List<String> requestIds = new CopyOnWriteArrayList<>();
        server.createContext("/v1/chat/completions", exchange -> {
            requestIds.add(exchange.getRequestHeaders().getFirst("X-Request-ID"));
            if (calls.incrementAndGet() == 1) {
                exchange.getResponseHeaders().add("Retry-After", "0");
                respond(exchange, 429, "{\"error\":\"rate limited\"}");
                return;
            }
            respond(exchange, 200,
                    "{\"id\":\"provider-2\",\"choices\":[{\"message\":{\"content\":\"retried-ok\"}}]}");
        });
        configure("deepseek-chat", "2");

        assertThat(service.sendRequest("hello")).isEqualTo("retried-ok");
        assertThat(calls).hasValue(2);
        assertThat(requestIds).hasSize(2).doesNotContainNull();
        assertThat(requestIds.get(0)).isEqualTo(requestIds.get(1));
    }

    @Test
    void doesNotRetryServerErrorOrLeakProviderBody(CapturedOutput output) {
        AtomicInteger calls = new AtomicInteger();
        server.createContext("/v1/chat/completions", exchange -> {
            calls.incrementAndGet();
            exchange.getResponseHeaders().add("x-request-id", "provider-safe-id");
            respond(exchange, 500, "{\"error\":\"secret-body-marker\"}");
        });
        configure("deepseek-chat", "2");

        assertThatThrownBy(() -> service.sendRequest("hello"))
                .isInstanceOfSatisfying(AiProviderException.class, error -> {
                    assertThat(error.getCode()).isEqualTo(AiProviderException.Code.HTTP_5XX);
                    assertThat(error.getProviderRequestId()).isEqualTo("provider-safe-id");
                    assertThat(error.isOutcomeUnknown()).isTrue();
                    assertThat(error.getMessage()).doesNotContain("secret-body-marker");
                });
        assertThat(calls).hasValue(1);
        assertThat(output).contains("bodyHash=").doesNotContain("secret-body-marker");
    }

    @Test
    void totalDeadlineStopsSlowRequestWithoutRetrying() {
        AtomicInteger calls = new AtomicInteger();
        server.createContext("/v1/chat/completions", exchange -> {
            calls.incrementAndGet();
            try {
                Thread.sleep(1500);
                respond(exchange, 200,
                        "{\"choices\":[{\"message\":{\"content\":\"too-late\"}}]}");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (IOException ignored) {
                // 客户端总超时后关闭连接是本测试的预期行为。
            }
        });
        configure("deepseek-chat", "1");
        long started = System.nanoTime();

        assertThatThrownBy(() -> service.sendRequest("hello"))
                .isInstanceOfSatisfying(AiProviderException.class, error -> {
                    assertThat(error.getCode()).isEqualTo(AiProviderException.Code.TIMEOUT);
                    assertThat(error.isOutcomeUnknown()).isTrue();
                });
        long elapsedMillis = (System.nanoTime() - started) / 1_000_000;
        assertThat(elapsedMillis).isLessThan(2500);
        assertThat(calls).hasValue(1);
    }

    @Test
    void networkFailureIsUnknownAndIsNotRetried() throws IOException {
        final int unavailablePort;
        try (ServerSocket socket = new ServerSocket(0)) {
            unavailablePort = socket.getLocalPort();
        }
        baseUrl = "http://127.0.0.1:" + unavailablePort;
        configure("deepseek-chat", "1");

        assertThatThrownBy(() -> service.sendRequest("hello"))
                .isInstanceOfSatisfying(AiProviderException.class, error -> {
                    assertThat(error.getCode()).isEqualTo(AiProviderException.Code.NETWORK);
                    assertThat(error.isOutcomeUnknown()).isTrue();
                });
    }

    @Test
    void rejectsEmptySuccessEnvelope() {
        server.createContext("/v1/chat/completions", exchange -> respond(exchange, 200,
                "{\"choices\":[{\"message\":{\"content\":\"   \"}}]}"));
        configure("deepseek-chat", "2");

        assertThatThrownBy(() -> service.sendRequest("hello"))
                .isInstanceOfSatisfying(AiProviderException.class, error -> {
                    assertThat(error.getCode()).isEqualTo(AiProviderException.Code.EMPTY_RESPONSE);
                    assertThat(error.isOutcomeUnknown()).isTrue();
                });
    }

    @Test
    void rejectsEmptyHttpBody() {
        server.createContext("/v1/chat/completions", exchange -> respond(exchange, 200, ""));
        configure("deepseek-chat", "2");

        assertThatThrownBy(() -> service.sendRequest("hello"))
                .isInstanceOfSatisfying(AiProviderException.class, error -> {
                    assertThat(error.getCode()).isEqualTo(AiProviderException.Code.EMPTY_RESPONSE);
                    assertThat(error.isOutcomeUnknown()).isTrue();
                });
    }

    @Test
    void malformedRetryAfterDoesNotRetry() {
        AtomicInteger calls = new AtomicInteger();
        server.createContext("/v1/chat/completions", exchange -> {
            calls.incrementAndGet();
            exchange.getResponseHeaders().add("Retry-After", "not-a-delay");
            respond(exchange, 429, "{\"error\":\"rate limited\"}");
        });
        configure("deepseek-chat", "2");

        assertThatThrownBy(() -> service.sendRequest("hello"))
                .isInstanceOfSatisfying(AiProviderException.class, error -> {
                    assertThat(error.getCode()).isEqualTo(AiProviderException.Code.RATE_LIMITED);
                    assertThat(error.isOutcomeUnknown()).isFalse();
                });
        assertThat(calls).hasValue(1);
    }

    @Test
    void serverErrorReasoningMarkerDoesNotTriggerEndpointFallback() {
        AtomicInteger chatCalls = new AtomicInteger();
        AtomicInteger responsesCalls = new AtomicInteger();
        server.createContext("/v1/chat/completions", exchange -> {
            chatCalls.incrementAndGet();
            respond(exchange, 500,
                    "{\"error\":{\"message\":\"reasoning.summary unsupported_value\"}}");
        });
        server.createContext("/v1/responses", exchange -> {
            responsesCalls.incrementAndGet();
            respond(exchange, 200, "{\"output_text\":\"must-not-be-used\"}");
        });
        configure("deepseek-chat", "2");

        assertThatThrownBy(() -> service.sendRequest("hello"))
                .isInstanceOfSatisfying(AiProviderException.class,
                        error -> assertThat(error.getCode()).isEqualTo(AiProviderException.Code.HTTP_5XX));
        assertThat(chatCalls).hasValue(1);
        assertThat(responsesCalls).hasValue(0);
    }

    @Test
    void invalidSuccessEnvelopeRequiresConfirmedRetry() {
        server.createContext("/v1/chat/completions", exchange -> respond(exchange, 200, "not-json"));
        configure("deepseek-chat", "2");

        assertThatThrownBy(() -> service.sendRequest("hello"))
                .isInstanceOfSatisfying(AiProviderException.class, error -> {
                    assertThat(error.getCode()).isEqualTo(AiProviderException.Code.INVALID_RESPONSE);
                    assertThat(error.isOutcomeUnknown()).isTrue();
                });
    }

    @Test
    void reasoningCompatibilityFallbackSharesTwoRequestBudget() {
        AtomicInteger calls = new AtomicInteger();
        List<String> requestIds = new CopyOnWriteArrayList<>();
        server.createContext("/v1/chat/completions", exchange -> {
            calls.incrementAndGet();
            requestIds.add(exchange.getRequestHeaders().getFirst("X-Request-ID"));
            respond(exchange, 400,
                    "{\"error\":{\"message\":\"reasoning.summary unsupported_value\"}}");
        });
        server.createContext("/v1/responses", exchange -> {
            calls.incrementAndGet();
            requestIds.add(exchange.getRequestHeaders().getFirst("X-Request-ID"));
            respond(exchange, 200, "{\"id\":\"provider-fallback\",\"output_text\":\"fallback-ok\"}");
        });
        configure("deepseek-chat", "2");

        assertThat(service.sendRequest("hello")).isEqualTo("fallback-ok");
        assertThat(calls).hasValue(2);
        assertThat(requestIds).hasSize(2);
        assertThat(requestIds.get(0)).isEqualTo(requestIds.get(1));
    }

    private void configure(String model, String timeoutSeconds) {
        when(configService.getAiConfigs()).thenReturn(Map.of(
                "AI_PROVIDER", "api",
                "BASE_URL", baseUrl,
                "API_KEY", "fixture-key",
                "MODEL", model,
                "AI_REQUEST_TIMEOUT_SECONDS", timeoutSeconds
        ));
    }

    private void respond(HttpExchange exchange, int status, String body) throws IOException {
        exchange.getRequestBody().readAllBytes();
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
