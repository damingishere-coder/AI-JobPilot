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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
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
                environment
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
        when(configMapper.selectOne(any()))
                .thenReturn(blankConfig("BASE_URL"))
                .thenReturn(blankConfig("API_KEY"))
                .thenReturn(blankConfig("MODEL"));
        when(environment.getProperty("BASE_URL")).thenReturn("https://api.deepseek.com");
        when(environment.getProperty("API_KEY")).thenReturn("env-api-key");
        when(environment.getProperty("MODEL")).thenReturn("deepseek-chat");

        Map<String, String> configs = configService.getAiConfigs();

        assertThat(configs)
                .containsEntry("BASE_URL", "https://api.deepseek.com")
                .containsEntry("API_KEY", "env-api-key")
                .containsEntry("MODEL", "deepseek-chat");
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

    private ConfigEntity blankConfig(String key) {
        ConfigEntity entity = new ConfigEntity();
        entity.setConfigKey(key);
        entity.setConfigValue(" ");
        return entity;
    }
}
