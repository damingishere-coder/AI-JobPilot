package com.getjobs.application.controller;

import com.getjobs.application.entity.AiEntity;
import com.getjobs.application.service.AiService;
import com.getjobs.application.service.ProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AiConfigControllerThresholdTest {
    private AiService aiService;
    private AiConfigController controller;

    @BeforeEach
    void setUp() {
        aiService = mock(AiService.class);
        ProfileService profileService = mock(ProfileService.class);
        controller = new AiConfigController();
        ReflectionTestUtils.setField(controller, "aiService", aiService);
        ReflectionTestUtils.setField(controller, "profileService", profileService);
    }

    @Test
    void savesAndReturnsServerThresholdValues() {
        AiEntity saved = new AiEntity();
        saved.setApplyThreshold(60);
        saved.setPriorityApplyThreshold(50);
        when(aiService.saveOrUpdateAiThresholds(60, 50)).thenReturn(saved);

        AiConfigController.AiThresholdRequest request = new AiConfigController.AiThresholdRequest();
        request.setApplyThreshold(60);
        request.setPriorityApplyThreshold(50);

        ResponseEntity<Map<String, Object>> response = controller.saveAiThresholds(request);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).containsEntry("success", true);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getBody().get("data");
        assertThat(data)
                .containsEntry("applyThreshold", 60)
                .containsEntry("priorityApplyThreshold", 50);
    }

    @Test
    void returnsReadableValidationError() {
        when(aiService.saveOrUpdateAiThresholds(60, 70))
                .thenThrow(new IllegalArgumentException("优先公司分数线不能高于普通公司分数线"));

        AiConfigController.AiThresholdRequest request = new AiConfigController.AiThresholdRequest();
        request.setApplyThreshold(60);
        request.setPriorityApplyThreshold(70);

        ResponseEntity<Map<String, Object>> response = controller.saveAiThresholds(request);

        assertThat(response.getStatusCode().is4xxClientError()).isTrue();
        assertThat(response.getBody())
                .containsEntry("success", false)
                .containsEntry("message", "优先公司分数线不能高于普通公司分数线");
    }
}
