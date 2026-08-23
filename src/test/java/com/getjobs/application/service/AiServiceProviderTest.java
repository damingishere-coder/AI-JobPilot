package com.getjobs.application.service;

import com.getjobs.application.mapper.AiMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AiServiceProviderTest {
    @Mock
    private ConfigService configService;
    @Mock
    private AiMapper aiMapper;
    @Mock
    private ProfileService profileService;
    @Mock
    private CodexCliService codexCliService;

    private AiService service;

    @BeforeEach
    void setUp() {
        service = new AiService(configService, aiMapper, profileService, codexCliService);
    }

    @Test
    void textRequestUsesCodexWithoutApiKey() {
        Map<String, String> config = Map.of(
                "AI_PROVIDER", "codex",
                "CODEX_PATH", "codex",
                "CODEX_MODEL", "gpt-5.6-sol"
        );
        when(configService.getAiConfigs()).thenReturn(config);
        when(codexCliService.generateText("岗位分析", config)).thenReturn("{\"decision\":\"SKIP\"}");

        assertThat(service.sendRequest("岗位分析")).isEqualTo("{\"decision\":\"SKIP\"}");
        verify(codexCliService).generateText("岗位分析", config);
    }

    @Test
    void imageResumeUsesCodexImageAttachment() {
        Map<String, String> config = Map.of("AI_PROVIDER", "codex");
        byte[] image = new byte[]{1, 2, 3};
        when(configService.getAiConfigs()).thenReturn(config);
        when(codexCliService.extractResumeFromImage(eq(image), eq("image/png"), any()))
                .thenReturn("候选人简历文本");

        assertThat(service.extractResumeFromImage(image, "image/png")).isEqualTo("候选人简历文本");
        verify(codexCliService).extractResumeFromImage(image, "image/png", config);
    }
}
