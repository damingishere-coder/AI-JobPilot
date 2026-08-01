package com.getjobs.application.controller;

import com.getjobs.application.dto.ConfirmBatchRequest;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.service.BossService;
import com.getjobs.application.service.BossStatsService;
import com.getjobs.application.service.DeliveryStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BossAnalyticsControllerTest {
    private BossService bossService;
    private BossAnalyticsController controller;

    @BeforeEach
    void setUp() {
        bossService = mock(BossService.class);
        controller = new BossAnalyticsController(bossService, mock(BossStatsService.class));
    }

    @Test
    void listPassesMinimumAiScoreToService() {
        when(bossService.listBossJobs(
                isNull(), isNull(), isNull(), isNull(), isNull(), isNull(), isNull(),
                anyInt(), anyInt(), anyBoolean(), isNull(), eq(60)
        )).thenReturn(new BossService.PagedResult());

        controller.list(
                null,
                null,
                null,
                null,
                null,
                null,
                60,
                null,
                null,
                false,
                1,
                20
        );

        verify(bossService).listBossJobs(
                isNull(), isNull(), isNull(), isNull(), isNull(), isNull(), isNull(),
                eq(1), eq(20), eq(false), isNull(), eq(60)
        );
    }

    @Test
    void manualOverrideDeduplicatesIdsAndOnlyReturnsValidAiNotMatchJobs() {
        BossJobDataEntity valid = job(1L, DeliveryStatus.AI_NOT_MATCH, "https://www.zhipin.com/job_detail/1.html");
        BossJobDataEntity waiting = job(2L, DeliveryStatus.WAITING_CONFIRM, "https://www.zhipin.com/job_detail/2.html");
        BossJobDataEntity missingUrl = job(3L, DeliveryStatus.AI_NOT_MATCH, "");
        BossJobDataEntity delivered = job(4L, DeliveryStatus.DELIVERED, "https://www.zhipin.com/job_detail/4.html");
        when(bossService.getBossJobById(1L)).thenReturn(valid);
        when(bossService.getBossJobById(2L)).thenReturn(waiting);
        when(bossService.getBossJobById(3L)).thenReturn(missingUrl);
        when(bossService.getBossJobById(4L)).thenReturn(delivered);
        when(bossService.getBossJobById(999L)).thenReturn(null);

        ConfirmBatchRequest request = new ConfirmBatchRequest();
        request.setManualOverrideAiNotMatch(true);
        request.setIds(List.of(1L, 1L, 2L, 3L, 4L, 999L));

        Map<String, Object> response = controller.confirmBatch(request);

        assertThat(response)
                .containsEntry("success", true)
                .containsEntry("count", 1);
        assertThat(response.get("message").toString()).contains("跳过 4 个");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tasks = (List<Map<String, Object>>) response.get("tasks");
        assertThat(tasks).singleElement().satisfies(task -> {
            assertThat(task).containsEntry("id", 1L);
            assertThat(task).containsEntry("url", "https://www.zhipin.com/job_detail/1.html");
        });
    }

    @Test
    void manualOverrideRejectsEmptyOrConflictingModes() {
        ConfirmBatchRequest empty = new ConfirmBatchRequest();
        empty.setManualOverrideAiNotMatch(true);
        assertThat(controller.confirmBatch(empty))
                .containsEntry("success", false)
                .containsEntry("count", 0);

        ConfirmBatchRequest conflicting = new ConfirmBatchRequest();
        conflicting.setManualOverrideAiNotMatch(true);
        conflicting.setAiRecommendedOnly(true);
        conflicting.setIds(List.of(1L));
        assertThat(controller.confirmBatch(conflicting))
                .containsEntry("success", false)
                .containsEntry("count", 0);
    }

    private BossJobDataEntity job(Long id, String status, String url) {
        BossJobDataEntity job = new BossJobDataEntity();
        job.setId(id);
        job.setDeliveryStatus(status);
        job.setJobUrl(url);
        job.setCompanyName("测试公司");
        job.setJobName("测试岗位");
        return job;
    }
}
