package com.getjobs.application.controller;

import com.getjobs.application.dto.ChromeJobBatchRequest;
import com.getjobs.application.dto.ChromeJobDto;
import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.service.JobAnalysisTaskStore;
import com.getjobs.application.service.ChromeJobAnalysisQueueService;
import com.getjobs.application.service.ProfileService;
import com.getjobs.application.service.ZhilianService;
import com.getjobs.worker.service.JobRunCoordinator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ZhilianControllerProfileIsolationTest {
    private final ZhilianService zhilianService = mock(ZhilianService.class);
    private final ProfileService profileService = mock(ProfileService.class);
    private final JobRunCoordinator jobRunCoordinator = mock(JobRunCoordinator.class);
    private final ChromeJobAnalysisQueueService queueService = mock(ChromeJobAnalysisQueueService.class);
    private ZhilianController controller;

    @BeforeEach
    void setUp() {
        controller = new ZhilianController();
        ReflectionTestUtils.setField(controller, "zhilianService", zhilianService);
        ReflectionTestUtils.setField(controller, "profileService", profileService);
        ReflectionTestUtils.setField(controller, "jobRunCoordinator", jobRunCoordinator);
        ReflectionTestUtils.setField(controller, "chromeJobAnalysisQueueService", queueService);
        when(profileService.getCurrentProfileIdOrNull()).thenReturn(4L);
    }

    @Test
    void rejectsMissingProfileBeforeDedupeOrPersistence() {
        ChromeJobBatchRequest request = new ChromeJobBatchRequest();

        ResponseEntity<Map<String, Object>> dedupe = controller.dedupeChromeJobs(request);
        ResponseEntity<Map<String, Object>> submit = controller.receiveChromeJobs(request);

        assertThat(dedupe.getStatusCode().value()).isEqualTo(400);
        assertThat(dedupe.getBody()).containsEntry("errorCode", "PROFILE_REQUIRED");
        assertThat(submit.getStatusCode().value()).isEqualTo(400);
        assertThat(submit.getBody()).containsEntry("errorCode", "PROFILE_REQUIRED");
        verify(zhilianService, never()).existsByJobId(any(), any());
        verify(zhilianService, never()).upsertChromeJob(any(), any(), any());
        verify(queueService, never()).enqueue(any());
    }

    @Test
    void rejectsChangedProfileBeforeStopHasAnyEffect() {
        ResponseEntity<Map<String, Object>> response = controller.stopChromeZhilian(Map.of(
                "profileId", 3L,
                "runId", "old-profile-run"
        ));

        assertThat(response.getStatusCode().value()).isEqualTo(409);
        assertThat(response.getBody())
                .containsEntry("errorCode", "PROFILE_CHANGED")
                .containsEntry("currentProfileId", 4L);
        verify(jobRunCoordinator, never()).requestCancel(any());
    }

    @Test
    void partialFailureReturnsAllReceiptsAndDoesNotHideUnqueuedSavedJobs() {
        JobAnalysisTaskStore store = mock(JobAnalysisTaskStore.class);
        ReflectionTestUtils.setField(controller, "jobAnalysisTaskStore", store);
        ChromeJobBatchRequest request = new ChromeJobBatchRequest();
        request.setProfileId(4L); request.setRunId("partial-run");
        request.setJobs(List.of(job("A"), job("B"), job("C")));
        when(zhilianService.upsertChromeJob(any(), any(), any())).thenAnswer(call -> {
            ZhilianJobDataEntity entity = call.getArgument(0); entity.setId(1L); entity.setProfileId(4L); return entity;
        });
        var busy = ChromeJobAnalysisQueueService.EnqueueResult.rejected("busy");
        busy.setErrorCode("DB_BUSY"); busy.setRetryable(true);
        when(queueService.enqueue(any())).thenReturn(ChromeJobAnalysisQueueService.EnqueueResult.queued(1), busy,
                ChromeJobAnalysisQueueService.EnqueueResult.queued(2));
        var result = controller.receiveChromeJobs(request);
        assertThat(result.getStatusCode().value()).isEqualTo(200);
        assertThat(result.getBody()).containsEntry("partial", true).containsEntry("pending", 1L);
        var receipts = (List<Map<String, Object>>) result.getBody().get("items");
        assertThat(receipts).extracting(item -> item.get("status")).containsExactly("QUEUED", "REJECTED", "QUEUED");
        var orphan = new ZhilianJobDataEntity(); orphan.setJobId("B"); orphan.setDeliveryStatus("未投递");
        when(zhilianService.existsByJobId(4L,"B")).thenReturn(true);
        when(zhilianService.findByJobId(4L,"B")).thenReturn(orphan);
        request.setJobs(List.of(job("B")));
        assertThat(controller.dedupeChromeJobs(request).getBody()).containsEntry("newCount",1);
        when(store.hasTaskForJob(4L,"zhilian","B")).thenReturn(true);
        assertThat(controller.dedupeChromeJobs(request).getBody()).containsEntry("duplicateCount",1);
    }

    private ChromeJobDto job(String id) {
        var dto = new ChromeJobDto(); dto.setId(id); dto.setTitle("AI产品经理"); dto.setCompany("测试公司");
        dto.setUrl("https://www.zhaopin.com/jobdetail/"+id+".htm");
        dto.setDescription("岗位职责：负责产品需求分析与运营推广。任职要求：熟悉人工智能应用与数据分析，能够独立完成产品规划和交付。");
        return dto;
    }
}
