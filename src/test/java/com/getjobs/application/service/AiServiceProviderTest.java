package com.getjobs.application.service;

import com.getjobs.application.mapper.AiMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verifyNoInteractions;

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
                "CODEX_MODEL", "gpt-6-astra"
        );
        when(configService.getAiConfigs()).thenReturn(config);
        when(codexCliService.generateText("岗位分析", config)).thenReturn("{\"decision\":\"SKIP\"}");

        assertThat(service.sendRequest("岗位分析")).isEqualTo("{\"decision\":\"SKIP\"}");
        verify(codexCliService).generateText("岗位分析", config);
    }

    @Test void changedProviderIdentityStopsBeforeLaunchingCli() {
        when(configService.getAiConfigs()).thenReturn(Map.of("AI_PROVIDER","codex","CODEX_MODEL","new-model"));
        String expected=AnalysisContextService.providerIdentity(Map.of("AI_PROVIDER","codex","CODEX_MODEL","old-model"));
        org.assertj.core.api.Assertions.assertThatThrownBy(()->service.sendStructuredRequest("fixture","{}",expected))
            .hasMessageContaining("未调用 Provider");
        org.mockito.Mockito.verifyNoInteractions(codexCliService);
    }

    @Test
    void structuredRequestUsesCodexOutputSchema() {
        Map<String, String> config = Map.of(
                "AI_PROVIDER", "codex",
                "CODEX_PATH", "codex",
                "CODEX_MODEL", "gpt-5.6-sol"
        );
        String schema = "{\"type\":\"object\"}";
        when(configService.getAiConfigs()).thenReturn(config);
        when(codexCliService.generateStructuredText("岗位分析", schema, config))
                .thenReturn("{\"decision\":\"SKIP\"}");

        assertThat(service.sendStructuredRequest("岗位分析", schema))
                .isEqualTo("{\"decision\":\"SKIP\"}");
        verify(codexCliService).generateStructuredText("岗位分析", schema, config);
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

    @Test void hrGenerationAndAuditUseGpt61WithoutChangingOtherRequests() {
        var global = Map.of("AI_PROVIDER", "codex", "CODEX_MODEL", "gpt-6-astra", "CODEX_PATH", "codex");
        var hr = new java.util.HashMap<>(global);
        hr.put("CODEX_MODEL", "gpt-6.1-sol");
        when(configService.getAiConfigs()).thenReturn(global);
        when(codexCliService.generateStructuredText(anyString(), eq("{}"), eq(hr))).thenReturn("{}");
        when(codexCliService.generateText("岗位分析", global)).thenReturn("分析");
        assertThat(service.sendHrStructuredRequest("HR草稿", "{}")).isEqualTo("{}");
        assertThat(service.sendHrStructuredRequest("HR审核", "{}")).isEqualTo("{}");
        assertThat(service.sendRequest("岗位分析")).isEqualTo("分析");
        verify(codexCliService).generateStructuredText("HR草稿", "{}", hr);
        verify(codexCliService).generateStructuredText("HR审核", "{}", hr);
        verify(codexCliService).generateText("岗位分析", global);
        assertThat(global.get("CODEX_MODEL")).isEqualTo("gpt-6-astra");
    }

    @Test void hrImageReadingUsesTheSameDedicatedModel() {
        var global = Map.of("AI_PROVIDER", "codex", "CODEX_MODEL", "gpt-6-astra");
        var hr = Map.of("AI_PROVIDER", "codex", "CODEX_MODEL", "gpt-6.1-sol");
        var bytes = new byte[]{1, 2, 3};
        when(configService.getAiConfigs()).thenReturn(global);
        when(codexCliService.reviewResumeImages(any(), any(), eq("聊天图片"), eq(hr))).thenReturn("问题");
        assertThat(service.readHrImages(List.of(new AiService.ResumeImage(bytes,"image/png")), "聊天图片")).isEqualTo("问题");
        verify(codexCliService).reviewResumeImages(any(), eq(List.of("image/png")), eq("聊天图片"), eq(hr));
        assertThat(global.get("CODEX_MODEL")).isEqualTo("gpt-6-astra");
    }

    @Test void hrCannotSilentlyFallBackToAnotherProviderOrModel() {
        when(configService.getAiConfigs()).thenReturn(Map.of("AI_PROVIDER", "api", "MODEL", "other-model"));
        assertThatThrownBy(()->service.sendHrStructuredRequest("HR草稿", "{}"))
                .hasMessageContaining("不切换到其他模型");
        verifyNoInteractions(codexCliService);
    }
}
