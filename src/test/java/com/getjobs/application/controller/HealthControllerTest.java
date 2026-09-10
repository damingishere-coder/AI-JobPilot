package com.getjobs.application.controller;

import com.getjobs.application.service.ApplicationReadinessService;
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

        HealthController controller = controller(playwrightManager);
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

        HealthController controller = controller(playwrightManager);

        assertThat(controller.health().getBody()).containsEntry("status", "UP");
    }

    @Test
    void reportsUpBeforeLazyBrowserInitializationStarts() {
        PlaywrightManager playwrightManager = mock(PlaywrightManager.class);
        when(playwrightManager.isInitialized()).thenReturn(false);
        when(playwrightManager.isInitializing()).thenReturn(false);
        when(playwrightManager.getLastInitializationError()).thenReturn("");

        HealthController controller = controller(playwrightManager);
        Map<String, Object> response = controller.health().getBody();

        assertThat(response).containsEntry("status", "UP");

        @SuppressWarnings("unchecked")
        Map<String, Object> browserAutomation =
                (Map<String, Object>) response.get("browserAutomation");
        assertThat(browserAutomation)
                .containsEntry("available", true)
                .containsEntry("initialized", false)
                .containsEntry("initializing", false)
                .containsEntry("message", "浏览器自动化尚未启动，将在使用招聘平台功能时按需初始化");
    }

    @Test
    void readinessReturnsServiceUnavailableWhenDependenciesAreNotReady() {
        PlaywrightManager playwrightManager = mock(PlaywrightManager.class);
        ApplicationReadinessService readinessService = mock(ApplicationReadinessService.class);
        when(readinessService.check()).thenReturn(new ApplicationReadinessService.ReadinessReport(
                false, "DOWN", Map.of("database", Map.of("status", "DOWN"))));

        ResponseEntity<Map<String, Object>> response =
                new HealthController(playwrightManager, readinessService).ready();

        assertThat(response.getStatusCode().value()).isEqualTo(503);
        assertThat(response.getBody()).containsEntry("ready", false).containsEntry("status", "DOWN");
    }

    private HealthController controller(PlaywrightManager playwrightManager) {
        ApplicationReadinessService readinessService = mock(ApplicationReadinessService.class);
        return new HealthController(playwrightManager, readinessService);
    }
}
