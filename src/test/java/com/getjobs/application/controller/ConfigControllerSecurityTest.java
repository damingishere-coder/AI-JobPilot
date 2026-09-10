package com.getjobs.application.controller;

import com.getjobs.application.entity.ConfigEntity;
import com.getjobs.application.service.ConfigService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ConfigControllerSecurityTest {
    @Mock
    private ConfigService configService;

    @Test
    void singleSensitiveConfigReturnsStatusWithoutRawValue() {
        ConfigEntity secret = new ConfigEntity();
        secret.setConfigKey("API_KEY");
        secret.setConfigValue("sk-real-secret");
        when(configService.isUiConfigKeyAllowed("API_KEY")).thenReturn(true);
        when(configService.getConfigByKey("API_KEY")).thenReturn(secret);
        when(configService.isSensitiveUiConfigKey("API_KEY")).thenReturn(true);
        when(configService.isSensitiveUiConfigConfigured("API_KEY")).thenReturn(true);

        var response = new ConfigController(configService).getConfigByKey("API_KEY");

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).isNotNull();
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getBody().get("data");
        assertThat(data)
                .containsEntry("configured", true)
                .containsEntry("sensitive", true)
                .containsEntry("config_value", null);
        assertThat(response.getBody().toString()).doesNotContain("sk-real-secret");
    }

    @Test
    void rejectsUnknownSingleConfigRead() {
        when(configService.isUiConfigKeyAllowed("CODEX_HOME")).thenReturn(false);

        var response = new ConfigController(configService).getConfigByKey("CODEX_HOME");

        assertThat(response.getStatusCode().is4xxClientError()).isTrue();
        assertThat(response.getBody()).containsEntry("success", false);
    }
}
