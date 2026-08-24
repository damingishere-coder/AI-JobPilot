package com.getjobs.application.service;

import com.getjobs.application.entity.ConfigEntity;
import com.getjobs.application.mapper.ConfigMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.core.env.Environment;

import java.util.Map;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith({MockitoExtension.class, OutputCaptureExtension.class})
class ConfigServiceTest {
    @Mock
    private ConfigMapper configMapper;
    @Mock
    private Environment environment;

    private ConfigService configService;

    @BeforeEach
    void setUp() {
        configService = new ConfigService(
                configMapper,
                null,
                null,
                null,
                null,
                environment,
                new CodexCliService()
        );
    }

    @Test
    void batchUpdateCreatesMissingConfig() {
        when(configMapper.selectOne(any())).thenReturn(null);
        when(configMapper.insert(any(ConfigEntity.class))).thenReturn(1);

        int count = configService.batchUpdateConfigs(Map.of("BASE_URL", "https://api.deepseek.com"));

        ArgumentCaptor<ConfigEntity> captor = ArgumentCaptor.forClass(ConfigEntity.class);
        verify(configMapper).insert(captor.capture());
        verify(configMapper, never()).updateById(any(ConfigEntity.class));
        ConfigEntity created = captor.getValue();
        assertThat(count).isEqualTo(1);
        assertThat(created.getConfigKey()).isEqualTo("BASE_URL");
        assertThat(created.getConfigValue()).isEqualTo("https://api.deepseek.com");
        assertThat(created.getConfigType()).isEqualTo("string");
        assertThat(created.getCategory()).isEqualTo("ai");
        assertThat(created.getDescription()).isEqualTo("AI 服务地址");
        assertThat(created.getCreatedAt()).isNotNull();
        assertThat(created.getUpdatedAt()).isNotNull();
    }

    @Test
    void batchUpdateUpdatesExistingConfig() {
        ConfigEntity existing = new ConfigEntity();
        existing.setConfigKey("MODEL");
        existing.setConfigValue("old-model");
        when(configMapper.selectOne(any())).thenReturn(existing);
        when(configMapper.updateById(any(ConfigEntity.class))).thenReturn(1);

        int count = configService.batchUpdateConfigs(Map.of("MODEL", "deepseek-chat"));

        ArgumentCaptor<ConfigEntity> captor = ArgumentCaptor.forClass(ConfigEntity.class);
        verify(configMapper).updateById(captor.capture());
        verify(configMapper, never()).insert(any(ConfigEntity.class));
        ConfigEntity updated = captor.getValue();
        assertThat(count).isEqualTo(1);
        assertThat(updated.getConfigKey()).isEqualTo("MODEL");
        assertThat(updated.getConfigValue()).isEqualTo("deepseek-chat");
        assertThat(updated.getUpdatedAt()).isNotNull();
    }

    @Test
    void getAiConfigsFallsBackToEnvironmentWhenDatabaseValueIsBlank() {
        when(configMapper.selectOne(any())).thenReturn(null);
        Map<String, String> environmentValues = Map.of(
                "AI_PROVIDER", "api",
                "BASE_URL", "https://api.deepseek.com",
                "API_KEY", "env-api-key",
                "MODEL", "deepseek-chat"
        );
        when(environment.getProperty(any())).thenAnswer(invocation -> environmentValues.get(invocation.getArgument(0)));

        Map<String, String> configs = configService.getAiConfigs();

        assertThat(configs)
                .containsEntry("BASE_URL", "https://api.deepseek.com")
                .containsEntry("API_KEY", "env-api-key")
                .containsEntry("MODEL", "deepseek-chat")
                .containsEntry("AI_PROVIDER", "api");
    }

    @Test
    void codexIsDefaultAndDoesNotRequireApiKey() {
        when(configMapper.selectOne(any())).thenReturn(null);

        Map<String, String> configs = configService.getAiConfigs();

        assertThat(configs)
                .containsEntry("AI_PROVIDER", "codex")
                .containsEntry("CODEX_PATH", "codex")
                .containsEntry("CODEX_MODEL", "gpt-5.6-sol")
                .containsEntry("AI_REQUEST_TIMEOUT_SECONDS", "120")
                .containsEntry("API_KEY", "");
    }

    @Test
    void validatesRemoteApiTimeoutBeforeWriting() {
        assertThatThrownBy(() -> configService.batchUpdateConfigs(
                Map.of("AI_REQUEST_TIMEOUT_SECONDS", "0")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("1 到 1800");
        assertThatThrownBy(() -> configService.batchUpdateConfigs(
                Map.of("AI_REQUEST_TIMEOUT_SECONDS", "1801")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("1 到 1800");
        assertThatThrownBy(() -> configService.batchUpdateConfigs(
                Map.of("AI_REQUEST_TIMEOUT_SECONDS", "abc")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("整数");

        verify(configMapper, never()).insert(any(ConfigEntity.class));
        verify(configMapper, never()).updateById(any(ConfigEntity.class));
    }

    @Test
    void apiKeyValueIsHiddenInLogs(CapturedOutput output) {
        when(configMapper.selectOne(any())).thenReturn(null);
        when(configMapper.insert(any(ConfigEntity.class))).thenReturn(1);

        configService.batchUpdateConfigs(Map.of("API_KEY", "sk-real-secret"));

        assertThat(output).contains("API_KEY");
        assertThat(output).contains("[已隐藏]");
        assertThat(output).doesNotContain("sk-real-secret");
    }

    @Test
    void uiConfigSnapshotDoesNotExposeSecretsOrCodexHome() {
        ConfigEntity apiKey = config("API_KEY", "sk-real-secret");
        ConfigEntity hookUrl = config("HOOK_URL", "https://example.test/secret-hook");
        ConfigEntity codexHome = config("CODEX_HOME", "C:/private/codex-home");
        ConfigEntity model = config("MODEL", "deepseek-chat");
        when(configMapper.selectList(null)).thenReturn(List.of(apiKey, hookUrl, codexHome, model));

        Map<String, Object> configs = configService.getUiConfigsAsMap();

        assertThat(configs)
                .containsEntry("MODEL", "deepseek-chat")
                .containsEntry("API_KEY", null)
                .containsEntry("HOOK_URL", null)
                .doesNotContainKey("CODEX_HOME");
        assertThat(configs.toString())
                .doesNotContain("sk-real-secret")
                .doesNotContain("secret-hook")
                .doesNotContain("private/codex-home");
    }

    @Test
    void uiConfigSnapshotShowsNonSensitiveEnvironmentFallback() {
        when(configMapper.selectList(null)).thenReturn(List.of());
        when(environment.getProperty(anyString())).thenAnswer(invocation ->
                "AI_REQUEST_TIMEOUT_SECONDS".equals(invocation.getArgument(0)) ? "10" : null);

        Map<String, Object> configs = configService.getUiConfigsAsMap();

        assertThat(configs).containsEntry("AI_REQUEST_TIMEOUT_SECONDS", "10");
    }

    @Test
    void blankSensitiveValuePreservesExistingConfig() {
        ConfigEntity model = config("MODEL", "old-model");
        when(configMapper.selectOne(any())).thenReturn(model);
        when(configMapper.updateById(any(ConfigEntity.class))).thenReturn(1);

        int count = configService.batchUpdateConfigs(Map.of(
                "API_KEY", "",
                "MODEL", "new-model"
        ));

        assertThat(count).isEqualTo(1);
        verify(configMapper).updateById(model);
        assertThat(model.getConfigValue()).isEqualTo("new-model");
    }

    @Test
    void rejectsUnknownUiConfigBeforeWriting() {
        assertThatThrownBy(() -> configService.batchUpdateConfigs(Map.of("CODEX_HOME", "C:/private")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不允许");

        verify(configMapper, never()).insert(any(ConfigEntity.class));
        verify(configMapper, never()).updateById(any(ConfigEntity.class));
    }

    @Test
    void rejectsNonCodexExecutableBeforeWriting() {
        assertThatThrownBy(() -> configService.batchUpdateConfigs(Map.of("CODEX_PATH", "powershell.exe")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("仅允许 Codex CLI");

        verify(configMapper, never()).insert(any(ConfigEntity.class));
        verify(configMapper, never()).updateById(any(ConfigEntity.class));
    }

    @Test
    void sensitiveConfiguredStatusCanUseEnvironmentWithoutReturningValue() {
        when(configMapper.selectOne(any())).thenReturn(null);
        when(environment.getProperty("API_KEY")).thenReturn("env-secret");

        assertThat(configService.isSensitiveUiConfigConfigured("API_KEY")).isTrue();
    }

    private ConfigEntity config(String key, String value) {
        ConfigEntity entity = new ConfigEntity();
        entity.setConfigKey(key);
        entity.setConfigValue(value);
        return entity;
    }

}
