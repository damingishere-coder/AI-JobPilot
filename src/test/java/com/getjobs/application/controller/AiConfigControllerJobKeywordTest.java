package com.getjobs.application.controller;

import com.getjobs.application.service.AiService;
import com.getjobs.application.service.JobAiAnalysisService;
import com.getjobs.application.service.ProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AiConfigControllerJobKeywordTest {
    private final AiService aiService = mock(AiService.class);
    private final JobAiAnalysisService jobAiAnalysisService = mock(JobAiAnalysisService.class);
    private final ProfileService profileService = mock(ProfileService.class);
    private AiConfigController controller;

    @BeforeEach
    void setUp() {
        controller = new AiConfigController();
        ReflectionTestUtils.setField(controller, "aiService", aiService);
        ReflectionTestUtils.setField(controller, "jobAiAnalysisService", jobAiAnalysisService);
        ReflectionTestUtils.setField(controller, "profileService", profileService);
    }

    @Test
    @SuppressWarnings("unchecked")
    void generatePersistsKeywordsReturnedByTheSameAiCall() {
        Map<String, Object> generated = new LinkedHashMap<>();
        generated.put("introduce", "介绍");
        generated.put("prompt", "%s %s %s %s %s");
        generated.put("sayHi", "你好");
        generated.put("recommendedKeywords", List.of("AI产品经理", "RAG产品"));
        when(aiService.generateResumeAiConfig("简历")).thenReturn(generated);
        when(jobAiAnalysisService.saveRecommendedJobKeywords(List.of("AI产品经理", "RAG产品")))
                .thenReturn(List.of("AI产品经理", "RAG产品"));

        ResponseEntity<Map<String, Object>> response = controller.generateConfigFromResume(Map.of("resumeText", "简历"));

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat((Map<String, Object>) response.getBody().get("data"))
                .containsEntry("recommendedKeywords", List.of("AI产品经理", "RAG产品"));
        verify(jobAiAnalysisService).saveRecommendedJobKeywords(List.of("AI产品经理", "RAG产品"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void readEndpointReturnsSelectionPolicyAndCurrentProfileKeywords() {
        when(jobAiAnalysisService.getRecommendedJobKeywords()).thenReturn(List.of("AI产品经理"));
        when(profileService.hasProfiles()).thenReturn(true);

        ResponseEntity<Map<String, Object>> response = controller.getRecommendedJobKeywords();

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat((Map<String, Object>) response.getBody().get("data"))
                .containsEntry("keywords", List.of("AI产品经理"))
                .containsEntry("maxSelected", 8)
                .containsEntry("recommendedSelectionCount", 3);
    }
}
