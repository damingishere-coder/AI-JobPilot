package com.getjobs.application.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.filter.CorsFilter;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

class CorsConfigTest {

    private final CorsFilter corsFilter = new CorsConfig().corsFilter();

    @Test
    void manifestPublicKeyMatchesBackendExtensionId() throws Exception {
        Path manifestPath = Path.of(System.getProperty("user.dir"), "chrome-extension", "manifest.json");
        JsonNode manifest = new ObjectMapper().readTree(Files.readString(manifestPath));
        byte[] publicKey = Base64.getDecoder().decode(manifest.path("key").asText());
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(publicKey);
        StringBuilder id = new StringBuilder();
        for (int index = 0; index < 16; index++) {
            id.append((char) ('a' + ((hash[index] >>> 4) & 0x0f)));
            id.append((char) ('a' + (hash[index] & 0x0f)));
        }
        assertThat(id.toString()).isEqualTo(CorsConfig.CHROME_EXTENSION_ID);
    }

    @Test
    void allowsStableChromeExtensionForBossAndZhilianEndpoints() throws Exception {
        for (String path : new String[]{
                "/api/boss/chrome/jobs",
                "/api/boss/chrome/jobs/dedupe",
                "/api/boss/ai-keywords",
                "/api/boss/jobs/123/delivery-result",
                "/api/zhilian/chrome/jobs",
                "/api/zhilian/chrome/jobs/dedupe",
                "/api/zhilian/jobs/123/delivery-result"
        }) {
            MockHttpServletResponse response = preflight(path, CorsConfig.CHROME_EXTENSION_ORIGIN);
            assertThat(response.getStatus()).as(path).isEqualTo(200);
            assertThat(response.getHeader("Access-Control-Allow-Origin"))
                    .as(path).isEqualTo(CorsConfig.CHROME_EXTENSION_ORIGIN);
        }
    }

    @Test
    void rejectsUnknownChromeExtensionForBossCollectionEndpoint() throws Exception {
        MockHttpServletResponse response = preflight(
                "/api/boss/chrome/jobs",
                "chrome-extension://abcdefghijklmnop"
        );

        assertThat(response.getStatus()).isEqualTo(403);
    }

    @Test
    void rejectsUnknownChromeExtensionForBossDeliveryResultEndpoint() throws Exception {
        MockHttpServletResponse response = preflight(
                "/api/boss/jobs/123/delivery-result",
                "chrome-extension://abcdefghijklmnop"
        );

        assertThat(response.getStatus()).isEqualTo(403);
    }

    @Test
    void rejectsUnknownChromeExtensionForZhilianCollectionEndpoint() throws Exception {
        MockHttpServletResponse response = preflight(
                "/api/zhilian/chrome/jobs",
                "chrome-extension://abcdefghijklmnop"
        );

        assertThat(response.getStatus()).isEqualTo(403);
    }

    @Test
    void rejectsChromeExtensionForUnrelatedApi() throws Exception {
        MockHttpServletResponse response = preflight(
                "/api/config",
                "chrome-extension://abcdefghijklmnop"
        );

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("Invalid CORS request");
    }

    @Test
    void rejectsOrdinaryWebsiteForBossCollectionEndpoint() throws Exception {
        MockHttpServletResponse response = preflight(
                "/api/boss/chrome/jobs",
                "https://example.com"
        );

        assertThat(response.getStatus()).isEqualTo(403);
    }

    @Test
    void keepsLocalFrontendAccessForAllApis() throws Exception {
        MockHttpServletResponse response = preflight(
                "/api/config",
                "http://localhost:6866"
        );

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Access-Control-Allow-Origin"))
                .isEqualTo("http://localhost:6866");
    }

    private MockHttpServletResponse preflight(String path, String origin) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("OPTIONS", path);
        request.addHeader("Origin", origin);
        request.addHeader("Access-Control-Request-Method", "POST");
        request.addHeader("Access-Control-Request-Headers", "content-type");
        MockHttpServletResponse response = new MockHttpServletResponse();
        corsFilter.doFilter(request, response, new MockFilterChain());
        return response;
    }
}
