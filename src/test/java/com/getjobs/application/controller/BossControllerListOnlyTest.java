package com.getjobs.application.controller;

import com.getjobs.application.dto.ChromeJobBatchRequest;
import com.getjobs.application.dto.ChromeJobDto;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.service.BossService;
import com.getjobs.application.service.ChromeJobAnalysisQueueService;
import com.getjobs.application.service.ConfigService;
import com.getjobs.application.service.CookieService;
import com.getjobs.application.service.DeliveryStatus;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BossControllerListOnlyTest {

    @Test
    void savesListOnlyJobsWithoutEnqueueingAiAnalysis() {
        BossJobService bossJobService = mock(BossJobService.class);
        PlaywrightManager playwrightManager = mock(PlaywrightManager.class);
        CookieService cookieService = mock(CookieService.class);
        JobRunCoordinator jobRunCoordinator = mock(JobRunCoordinator.class);
        ConfigService configService = mock(ConfigService.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<Boss> bossProvider = mock(ObjectProvider.class);
        BossService bossService = mock(BossService.class);
        ProfileService profileService = mock(ProfileService.class);
        JobAiAnalysisService jobAiAnalysisService = mock(JobAiAnalysisService.class);
        ChromeJobAnalysisQueueService queueService = mock(ChromeJobAnalysisQueueService.class);
        Environment environment = mock(Environment.class);

        BossController controller = new BossController(
                bossJobService,
                playwrightManager,
                cookieService,
                jobRunCoordinator,
                configService,
                bossProvider,
                bossService,
                profileService,
                jobAiAnalysisService,
                queueService,
                environment
        );

        ChromeJobDto dto = new ChromeJobDto();
        dto.setId("job-1");
        dto.setTitle("Java工程师");
        dto.setCompany("测试公司");
        dto.setSalary("20-30K");
        dto.setLocation("深圳");
        dto.setUrl("https://www.zhipin.com/job_detail/job-1.html");
        dto.setKeyword("Java");
        dto.setDeliveryStatus(DeliveryStatus.LIST_COLLECTED);

        ChromeJobBatchRequest request = new ChromeJobBatchRequest();
        request.setRunId("boss-list-test");
        request.setKeyword("Java");
        request.setCollectionMode("LIST_ONLY");
        request.setAutoDeliver(false);
        request.setJobs(List.of(dto));

        BossJobDataEntity saved = new BossJobDataEntity();
        saved.setId(1L);
        saved.setEncryptId("job-1");
        saved.setJobName(dto.getTitle());
        saved.setCompanyName(dto.getCompany());
        saved.setSalary(dto.getSalary());
        saved.setLocation(dto.getLocation());
        saved.setJobUrl(dto.getUrl());
        saved.setDeliveryStatus(DeliveryStatus.LIST_COLLECTED);

        when(profileService.getCurrentProfileId()).thenReturn(1L);
        when(jobRunCoordinator.isCancelRequested("boss-list-test")).thenReturn(false);
        when(bossService.upsertChromeBossJob(any(BossJobDataEntity.class), eq("boss-list-test"))).thenReturn(saved);
        when(bossService.updateDeliveryStatusById(1L, DeliveryStatus.LIST_COLLECTED)).thenReturn(saved);
        when(queueService.queueSize()).thenReturn(0);

        ResponseEntity<Map<String, Object>> response = controller.receiveChromeJobs(request);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody())
                .containsEntry("success", true)
                .containsEntry("saved", 1)
                .containsEntry("listCollected", 1)
                .containsEntry("collectionMode", "LIST_ONLY")
                .containsEntry("asyncAnalysis", false);
        verify(queueService, never()).enqueue(any());
    }
}
