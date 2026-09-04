package com.getjobs.application.controller;

import com.getjobs.application.dto.ChromeJobBatchRequest;
import com.getjobs.application.service.ChromeJobAnalysisQueueService;
import com.getjobs.application.service.ProfileService;
import com.getjobs.application.service.ZhilianService;
import com.getjobs.worker.service.JobRunCoordinator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;

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
}
