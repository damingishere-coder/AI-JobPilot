package com.getjobs.application.controller;

import com.getjobs.application.service.ChromeJobAnalysisQueueService;
import com.getjobs.application.service.JobAnalysisTaskStore;
import com.getjobs.application.service.ProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AiConfigControllerJobTaskTest {
    private AiConfigController controller;
    private ProfileService profileService;
    private ChromeJobAnalysisQueueService queueService;

    @BeforeEach
    void setUp() {
        controller = new AiConfigController();
        profileService = mock(ProfileService.class);
        queueService = mock(ChromeJobAnalysisQueueService.class);
        ReflectionTestUtils.setField(controller, "profileService", profileService);
        ReflectionTestUtils.setField(controller, "chromeJobAnalysisQueueService", queueService);
        when(profileService.getCurrentProfileId()).thenReturn(7L);
    }

    @Test
    void taskListIsScopedToCurrentProfile() {
        when(queueService.listTasks(7L, 20)).thenReturn(List.of());
        when(queueService.queueSize(7L)).thenReturn(3);

        ResponseEntity<Map<String, Object>> response = controller.listJobAnalysisTasks(20);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody())
                .containsEntry("success", true)
                .containsEntry("queueSize", 3);
        verify(queueService).listTasks(7L, 20);
    }

    @Test
    void retryUsesCurrentProfileAndReturnsRejectedTransition() {
        when(queueService.retry(12L, 7L, false)).thenReturn(
                new JobAnalysisTaskStore.RetryResult(false, null, "仅 FAILED 或 UNKNOWN 任务允许显式重试"));

        ResponseEntity<Map<String, Object>> response = controller.retryJobAnalysisTask(12L, false);

        assertThat(response.getStatusCode().is4xxClientError()).isTrue();
        assertThat(response.getBody())
                .containsEntry("success", false)
                .containsEntry("message", "仅 FAILED 或 UNKNOWN 任务允许显式重试");
        verify(queueService).retry(12L, 7L, false);
    }
}
