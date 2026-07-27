package com.getjobs.application.controller;

import com.getjobs.worker.manager.PlaywrightManager;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class HealthControllerTest {

    @Test
    void reportsDegradedWhileKeepingHealthEndpointAvailable() {
        PlaywrightManager playwrightManager = mock(PlaywrightManager.class);
        when(playwrightManager.isInitialized()).thenReturn(false);
        when(playwrightManager.isInitializing()).thenReturn(false);
        when(playwrightManager.getLastInitializationError()).thenReturn("浏览器启动失败");

        HealthController controller = new HealthController(playwrightManager);
        ResponseEntity<Map<String, Object>> response = controller.health();

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).containsEntry("status", "DEGRADED");

        @SuppressWarnings("unchecked")
        Map<String, Object> browserAutomation =
                (Map<String, Object>) response.getBody().get("browserAutomation");
        assertThat(browserAutomation)
                .containsEntry("available", false)
                .containsEntry("initializing", false)
                .containsEntry("message", "浏览器启动失败");
    }

    @Test
    void reportsUpWhenBrowserAutomationIsReady() {
        PlaywrightManager playwrightManager = mock(PlaywrightManager.class);
        when(playwrightManager.isInitialized()).thenReturn(true);

        HealthController controller = new HealthController(playwrightManager);

        assertThat(controller.health().getBody()).containsEntry("status", "UP");
    }
}
