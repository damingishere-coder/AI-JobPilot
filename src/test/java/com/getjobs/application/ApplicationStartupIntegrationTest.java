package com.getjobs.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.init.ZhilianOptionInitializer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auto-open-browser=false",
        "app.browser.initialize-on-startup=false",
        "app.static-server.enabled=false"
})
class ApplicationStartupIntegrationTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Path TEST_ROOT = createTestRoot();

    @DynamicPropertySource
    static void testProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + TEST_ROOT.resolve("integration.db"));
        registry.add("app.paths.data-dir", () -> TEST_ROOT.resolve("data").toString());
        registry.add("app.paths.output-dir", () -> TEST_ROOT.resolve("output").toString());
        registry.add("app.paths.cache-dir", () -> TEST_ROOT.resolve("cache").toString());
        registry.add("app.paths.log-dir", () -> TEST_ROOT.resolve("logs").toString());
        registry.add("logging.file.name", () -> TEST_ROOT.resolve("logs/get-jobs.log").toString());
    }

    @LocalServerPort
    int port;

    @Autowired
    JdbcTemplate jdbcTemplate;

    @MockitoBean
    ZhilianOptionInitializer zhilianOptionInitializer;

    @Test
    void startsOnAnIsolatedV8DatabaseAndReportsReadyOverHttp() throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/api/ready"))
                .GET()
                .build();
        HttpResponse<String> response = HttpClient.newHttpClient()
                .send(request, HttpResponse.BodyHandlers.ofString());
        JsonNode body = MAPPER.readTree(response.body());

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(body.path("ready").asBoolean()).isTrue();
        assertThat(body.path("checks").path("database").path("schema").asText()).isEqualTo("VALID");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM flyway_schema_history WHERE success=1 AND version='8'", Integer.class))
                .isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("PRAGMA foreign_keys", Integer.class)).isEqualTo(1);
    }

    private static Path createTestRoot() {
        try {
            return Files.createTempDirectory("getjobs-startup-integration-");
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
