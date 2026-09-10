package com.getjobs.application.controller;

import com.getjobs.application.service.BossService;
import com.getjobs.application.service.ChromeJobAnalysisQueueService;
import com.getjobs.application.service.ConfigService;
import com.getjobs.application.service.CookieService;
import com.getjobs.application.service.JobAiAnalysisService;
import com.getjobs.application.service.ProfileService;
import com.getjobs.worker.boss.Boss;
import com.getjobs.worker.manager.PlaywrightManager;
import com.getjobs.worker.service.BossJobService;
import com.getjobs.worker.service.JobRunCoordinator;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.env.Environment;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BossControllerAiKeywordTest {
    @Test
    void providerFailureIsNotReportedAsEmptySuccess() {
        JobAiAnalysisService analysisService = mock(JobAiAnalysisService.class);
        when(analysisService.generateBossSearchKeywords(anyList(), anyInt()))
                .thenThrow(new IllegalStateException("AI Provider 服务异常"));
        BossController controller = new BossController(
                mock(BossJobService.class),
                mock(PlaywrightManager.class),
                mock(CookieService.class),
                mock(JobRunCoordinator.class),
                mock(ConfigService.class),
                mockBossProvider(),
                mock(BossService.class),
                mock(ProfileService.class),
                analysisService,
                mock(ChromeJobAnalysisQueueService.class),
                mock(Environment.class)
        );

        ResponseEntity<Map<String, Object>> response = controller.generateBossAiKeywords(
                Map.of("existingKeywords", List.of("Java"), "limit", 3)
        );

        assertThat(response.getStatusCode().value()).isEqualTo(502);
        assertThat(response.getBody())
                .containsEntry("success", false)
                .containsEntry("message", "AI Provider 服务异常")
                .containsEntry("keywords", List.of());
    }

    @SuppressWarnings("unchecked")
    private ObjectProvider<Boss> mockBossProvider() {
        return mock(ObjectProvider.class);
    }
}
