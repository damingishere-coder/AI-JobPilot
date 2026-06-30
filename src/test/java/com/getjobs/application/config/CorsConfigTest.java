package com.getjobs.application.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.filter.CorsFilter;

import static org.assertj.core.api.Assertions.assertThat;

class CorsConfigTest {

    private final CorsFilter corsFilter = new CorsConfig().corsFilter();

    @Test
    void allowsChromeExtensionForBossCollectionEndpoint() throws Exception {
        MockHttpServletResponse response = preflight(
                "/api/boss/chrome/jobs",
                "chrome-extension://abcdefghijklmnop"
        );

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Access-Control-Allow-Origin"))
                .isEqualTo("chrome-extension://abcdefghijklmnop");
    }

    @Test
    void allowsChromeExtensionForBossDeliveryResultEndpoint() throws Exception {
        MockHttpServletResponse response = preflight(
                "/api/boss/jobs/123/delivery-result",
                "chrome-extension://abcdefghijklmnop"
        );

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Access-Control-Allow-Origin"))
                .isEqualTo("chrome-extension://abcdefghijklmnop");
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
