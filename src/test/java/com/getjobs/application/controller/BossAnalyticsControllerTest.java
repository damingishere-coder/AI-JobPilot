package com.getjobs.application.controller;

import com.getjobs.application.dto.ConfirmBatchRequest;
import com.getjobs.application.dto.DeliveryResultRequest;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.service.BossService;
import com.getjobs.application.service.BossStatsService;
import com.getjobs.application.service.DeliveryStatus;
import com.getjobs.application.service.DeliveryAttemptService;
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
    private DeliveryAttemptService deliveryAttemptService;
    private BossAnalyticsController controller;

    @BeforeEach
    void setUp() {
        bossService = mock(BossService.class);
        deliveryAttemptService = mock(DeliveryAttemptService.class);
        controller = new BossAnalyticsController(bossService, mock(BossStatsService.class), deliveryAttemptService);
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
        when(deliveryAttemptService.requestBoss(1L, 1L, "boss-1", true)).thenReturn(
                new DeliveryAttemptService.RequestResult(
                        true, true, "request-1", DeliveryAttemptService.State.REQUESTED, "投递请求已创建"));

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
            assertThat(task).containsEntry("requestKey", "request-1");
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

    @Test
    void deliveryCallbackPassesRequestIdentityAndEvidenceToAttemptService() {
        BossJobDataEntity current = job(5L, DeliveryStatus.DELIVERY_REQUESTED, "https://www.zhipin.com/job_detail/5.html");
        when(bossService.getBossJobById(5L)).thenReturn(current);
        when(deliveryAttemptService.resolve(
                "boss", 1L, 5L, "request-5", DeliveryAttemptService.State.CONFIRMED,
                DeliveryAttemptService.PLATFORM_STATUS_TEXT, "页面显示已沟通", null, "页面显示已沟通"
        )).thenReturn(new DeliveryAttemptService.ResolutionResult(
                true, false, DeliveryAttemptService.State.CONFIRMED, "投递结果已写入"));

        DeliveryResultRequest request = new DeliveryResultRequest();
        request.setRequestKey("request-5");
        request.setOutcome("CONFIRMED");
        request.setEvidence(DeliveryAttemptService.PLATFORM_STATUS_TEXT);
        request.setMessage("页面显示已沟通");

        Map<String, Object> response = controller.updateDeliveryResult(5L, request);

        assertThat(response)
                .containsEntry("success", true)
                .containsEntry("state", "CONFIRMED");
    }

    @Test
    void confirmResumesTheSameRequestedAttemptAfterResponseLoss() {
        BossJobDataEntity current = job(6L, DeliveryStatus.DELIVERY_REQUESTED, "https://www.zhipin.com/job_detail/6.html");
        when(bossService.getBossJobById(6L)).thenReturn(current);
        when(deliveryAttemptService.requestBoss(6L, 1L, "boss-6", false)).thenReturn(
                new DeliveryAttemptService.RequestResult(
                        true, false, "request-6", DeliveryAttemptService.State.REQUESTED, "投递请求已存在"));

        Map<String, Object> response = controller.confirmPendingJob(6L);

        assertThat(response)
                .containsEntry("success", true)
                .containsEntry("resumed", true);
        @SuppressWarnings("unchecked")
        Map<String, Object> task = (Map<String, Object>) response.get("task");
        assertThat(task).containsEntry("requestKey", "request-6");
    }

    private BossJobDataEntity job(Long id, String status, String url) {
        BossJobDataEntity job = new BossJobDataEntity();
        job.setId(id);
        job.setProfileId(1L);
        job.setEncryptId("boss-" + id);
        job.setDeliveryStatus(status);
        job.setJobUrl(url);
        job.setCompanyName("测试公司");
        job.setJobName("测试岗位");
        return job;
    }
}
