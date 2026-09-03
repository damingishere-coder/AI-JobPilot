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
    void rejectsMissingOrChangedProfileWithoutSideEffects() {
        BossService bossService = mock(BossService.class);
        ProfileService profileService = mock(ProfileService.class);
        ChromeJobAnalysisQueueService queueService = mock(ChromeJobAnalysisQueueService.class);
        JobRunCoordinator jobRunCoordinator = mock(JobRunCoordinator.class);
        BossController controller = controller(bossService, profileService, queueService, jobRunCoordinator);
        when(profileService.getCurrentProfileIdOrNull()).thenReturn(4L);

        ChromeJobBatchRequest missing = new ChromeJobBatchRequest();
        missing.setJobs(List.of(chromeJob("job-missing", "公司", "岗位")));
        ResponseEntity<Map<String, Object>> missingResponse = controller.receiveChromeJobs(missing);

        ChromeJobBatchRequest changed = new ChromeJobBatchRequest();
        changed.setProfileId(3L);
        changed.setJobs(List.of(chromeJob("job-changed", "公司", "岗位")));
        ResponseEntity<Map<String, Object>> changedResponse = controller.receiveChromeJobs(changed);

        assertThat(missingResponse.getStatusCode().value()).isEqualTo(400);
        assertThat(missingResponse.getBody()).containsEntry("errorCode", "PROFILE_REQUIRED");
        assertThat(changedResponse.getStatusCode().value()).isEqualTo(409);
        assertThat(changedResponse.getBody())
                .containsEntry("errorCode", "PROFILE_CHANGED")
                .containsEntry("currentProfileId", 4L);
        verify(bossService, never()).upsertChromeBossJob(any(), any(), any());
        verify(queueService, never()).enqueue(any());
        verify(jobRunCoordinator, never()).requestCancel(any());
    }

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
        request.setProfileId(1L);
        request.setRunId("boss-list-test");
        request.setKeyword("Java");
        request.setCollectionMode("LIST_ONLY");
        // 旧版扩展即使仍传 true，扫描阶段也必须强制关闭自动投递。
        request.setAutoDeliver(true);
        request.setJobs(List.of(dto));

        BossJobDataEntity saved = new BossJobDataEntity();
        saved.setId(1L);
        saved.setProfileId(1L);
        saved.setEncryptId("job-1");
        saved.setJobName(dto.getTitle());
        saved.setCompanyName(dto.getCompany());
        saved.setSalary(dto.getSalary());
        saved.setLocation(dto.getLocation());
        saved.setJobUrl(dto.getUrl());
        saved.setDeliveryStatus(DeliveryStatus.LIST_COLLECTED);

        when(profileService.getCurrentProfileIdOrNull()).thenReturn(1L);
        when(jobRunCoordinator.isCancelRequested("boss-list-test")).thenReturn(false);
        when(bossService.upsertChromeBossJob(any(BossJobDataEntity.class), eq("boss-list-test"), eq(1L))).thenReturn(saved);
        when(bossService.updateDeliveryStatusById(1L, DeliveryStatus.LIST_COLLECTED)).thenReturn(saved);
        when(queueService.queueSize()).thenReturn(0);

        ResponseEntity<Map<String, Object>> response = controller.receiveChromeJobs(request);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody())
                .containsEntry("success", true)
                .containsEntry("saved", 1)
                .containsEntry("listCollected", 1)
                .containsEntry("collectionMode", "LIST_ONLY")
                .containsEntry("asyncAnalysis", false)
                .containsEntry("autoDeliver", false)
                .containsEntry("tasks", List.of());
        verify(queueService, never()).enqueue(any());
    }

    @Test
    void dedupeReturnsNewSkipAndEnrichAcrossHistoricalRuns() {
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

        ChromeJobDto complete = chromeJob("job-complete", "完整公司", "完整岗位");
        ChromeJobDto collected = chromeJob("job-collected", "待补全公司", "待补全岗位");
        ChromeJobDto fresh = chromeJob("job-new", "新公司", "新岗位");
        ChromeJobBatchRequest request = new ChromeJobBatchRequest();
        request.setProfileId(1L);
        request.setRunId("run-new");
        request.setJobs(List.of(complete, collected, fresh));

        BossJobDataEntity completeExisting = savedJob(1L, complete, DeliveryStatus.WAITING_CONFIRM);
        completeExisting.setJobDescription("这是已经完整采集并完成AI分析的岗位详情内容，长度足够用于查重判断。");
        BossJobDataEntity collectedExisting = savedJob(2L, collected, DeliveryStatus.LIST_COLLECTED);
        collectedExisting.setJobDescription("");

        when(profileService.getCurrentProfileIdOrNull()).thenReturn(1L);
        when(bossService.findExistingChromeBossJobs(eq(1L), any(), eq(null)))
                .thenReturn(Map.of(0, completeExisting, 1, collectedExisting));

        ResponseEntity<Map<String, Object>> response = controller.dedupeChromeJobs(request);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) response.getBody().get("items");
        assertThat(items).extracting(item -> item.get("action"))
                .containsExactly("SKIP", "ENRICH", "NEW");
        assertThat(response.getBody())
                .containsEntry("duplicateCount", 2)
                .containsEntry("enrichCount", 1L)
                .containsEntry("skipCount", 1L)
                .containsEntry("newCount", 1);
    }

    @Test
    void dedupeRequiresCompletedOrInFlightAnalysisBeforeHistoricalReuse() {
        BossService bossService = mock(BossService.class);
        ProfileService profileService = mock(ProfileService.class);
        BossController controller = controller(
                bossService,
                profileService,
                mock(ChromeJobAnalysisQueueService.class),
                mock(JobRunCoordinator.class)
        );
        ChromeJobDto dto = chromeJob("job-not-analyzed", "待分析公司", "待分析岗位");
        ChromeJobBatchRequest request = new ChromeJobBatchRequest();
        request.setProfileId(1L);
        request.setJobs(List.of(dto));
        BossJobDataEntity existing = savedJob(21L, dto, DeliveryStatus.NOT_DELIVERED);

        when(profileService.getCurrentProfileIdOrNull()).thenReturn(1L);
        when(bossService.findExistingChromeBossJobs(eq(1L), any(), eq(null))).thenReturn(Map.of(0, existing));

        ResponseEntity<Map<String, Object>> response = controller.dedupeChromeJobs(request);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) response.getBody().get("items");
        assertThat(items).extracting(item -> item.get("action")).containsExactly("ENRICH");
    }

    @Test
    void reusesHistoricalJobWithoutUpsertOrAiEnqueue() {
        BossService bossService = mock(BossService.class);
        ProfileService profileService = mock(ProfileService.class);
        ChromeJobAnalysisQueueService queueService = mock(ChromeJobAnalysisQueueService.class);
        JobRunCoordinator jobRunCoordinator = mock(JobRunCoordinator.class);
        BossController controller = controller(bossService, profileService, queueService, jobRunCoordinator);

        ChromeJobDto dto = chromeJob("job-history", "历史公司", "历史岗位");
        dto.setCollectionAction("REUSE_HISTORY");
        ChromeJobBatchRequest request = new ChromeJobBatchRequest();
        request.setProfileId(1L);
        request.setRunId("boss-current");
        request.setJobs(List.of(dto));

        BossJobDataEntity existing = savedJob(31L, dto, DeliveryStatus.AI_NOT_MATCH);
        existing.setAiScore(58);
        existing.setAiReason("历史分析结果");
        BossJobDataEntity restored = savedJob(31L, dto, DeliveryStatus.AI_NOT_MATCH);
        restored.setAiScore(58);
        restored.setAiReason("历史分析结果");
        restored.setScanRunId("boss-current");
        restored.setScanResultSource(BossService.SCAN_RESULT_HISTORICAL);

        when(profileService.getCurrentProfileIdOrNull()).thenReturn(1L);
        when(jobRunCoordinator.isCancelRequested("boss-current")).thenReturn(false);
        when(bossService.findExistingChromeBossJobs(eq(1L), any(), eq(null))).thenReturn(Map.of(0, existing));
        when(bossService.reuseHistoricalBossJob(31L, 1L, "boss-current")).thenReturn(restored);
        when(queueService.queueSize()).thenReturn(0);

        ResponseEntity<Map<String, Object>> response = controller.receiveChromeJobs(request);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody())
                .containsEntry("success", true)
                .containsEntry("saved", 0)
                .containsEntry("queued", 0)
                .containsEntry("restored", 1)
                .containsEntry("rejectedCount", 0);
        verify(bossService, never()).upsertChromeBossJob(any(), any(), any());
        verify(queueService, never()).enqueue(any());
    }

    @Test
    void rejectsHistoricalReuseWhenJobNowNeedsEnrichment() {
        BossService bossService = mock(BossService.class);
        ProfileService profileService = mock(ProfileService.class);
        ChromeJobAnalysisQueueService queueService = mock(ChromeJobAnalysisQueueService.class);
        JobRunCoordinator jobRunCoordinator = mock(JobRunCoordinator.class);
        BossController controller = controller(bossService, profileService, queueService, jobRunCoordinator);

        ChromeJobDto dto = chromeJob("job-changed", "变化公司", "变化岗位");
        dto.setCollectionAction("REUSE_HISTORY");
        ChromeJobBatchRequest request = new ChromeJobBatchRequest();
        request.setProfileId(1L);
        request.setRunId("boss-current");
        request.setJobs(List.of(dto));
        BossJobDataEntity needsEnrichment = savedJob(41L, dto, DeliveryStatus.LIST_COLLECTED);

        when(profileService.getCurrentProfileIdOrNull()).thenReturn(1L);
        when(jobRunCoordinator.isCancelRequested("boss-current")).thenReturn(false);
        when(bossService.findExistingChromeBossJobs(eq(1L), any(), eq(null))).thenReturn(Map.of(0, needsEnrichment));

        ResponseEntity<Map<String, Object>> response = controller.receiveChromeJobs(request);

        assertThat(response.getStatusCode().value()).isEqualTo(429);
        assertThat(response.getBody())
                .containsEntry("success", false)
                .containsEntry("status", "FAILED")
                .containsEntry("rejectedCount", 1);
        verify(bossService, never()).reuseHistoricalBossJob(any(), any(), any());
        verify(bossService, never()).upsertChromeBossJob(any(), any(), any());
        verify(queueService, never()).enqueue(any());
    }

    @Test
    void rejectsHistoricalReuseWhenCurrentProfileHasNoMatchingJob() {
        BossService bossService = mock(BossService.class);
        ProfileService profileService = mock(ProfileService.class);
        ChromeJobAnalysisQueueService queueService = mock(ChromeJobAnalysisQueueService.class);
        JobRunCoordinator jobRunCoordinator = mock(JobRunCoordinator.class);
        BossController controller = controller(bossService, profileService, queueService, jobRunCoordinator);

        ChromeJobDto dto = chromeJob("job-other-profile", "其他档案公司", "其他档案岗位");
        dto.setCollectionAction("REUSE_HISTORY");
        ChromeJobBatchRequest request = new ChromeJobBatchRequest();
        request.setProfileId(1L);
        request.setRunId("boss-current");
        request.setJobs(List.of(dto));

        when(profileService.getCurrentProfileIdOrNull()).thenReturn(1L);
        when(jobRunCoordinator.isCancelRequested("boss-current")).thenReturn(false);
        when(bossService.findExistingChromeBossJobs(eq(1L), any(), eq(null))).thenReturn(Map.of());

        ResponseEntity<Map<String, Object>> response = controller.receiveChromeJobs(request);

        assertThat(response.getStatusCode().value()).isEqualTo(429);
        assertThat(response.getBody())
                .containsEntry("success", false)
                .containsEntry("status", "FAILED")
                .containsEntry("rejectedCount", 1);
        verify(bossService, never()).reuseHistoricalBossJob(any(), any(), any());
        verify(bossService, never()).upsertChromeBossJob(any(), any(), any());
        verify(queueService, never()).enqueue(any());
    }

    @Test
    void rejectsHistoricalReuseWithoutVerifiableBossJobId() {
        BossService bossService = mock(BossService.class);
        ProfileService profileService = mock(ProfileService.class);
        ChromeJobAnalysisQueueService queueService = mock(ChromeJobAnalysisQueueService.class);
        JobRunCoordinator jobRunCoordinator = mock(JobRunCoordinator.class);
        BossController controller = controller(bossService, profileService, queueService, jobRunCoordinator);

        ChromeJobDto dto = chromeJob("", "历史公司", "历史岗位");
        dto.setUrl("");
        dto.setCollectionAction("REUSE_HISTORY");
        ChromeJobBatchRequest request = new ChromeJobBatchRequest();
        request.setProfileId(1L);
        request.setRunId("boss-current");
        request.setJobs(List.of(dto));

        when(profileService.getCurrentProfileIdOrNull()).thenReturn(1L);
        when(jobRunCoordinator.isCancelRequested("boss-current")).thenReturn(false);

        ResponseEntity<Map<String, Object>> response = controller.receiveChromeJobs(request);

        assertThat(response.getStatusCode().value()).isEqualTo(429);
        assertThat(response.getBody()).containsEntry("rejectedCount", 1);
        verify(bossService, never()).findExistingChromeBossJobs(any(), any(), any());
        verify(bossService, never()).reuseHistoricalBossJob(any(), any(), any());
        verify(queueService, never()).enqueue(any());
    }

    private BossController controller(BossService bossService,
                                      ProfileService profileService,
                                      ChromeJobAnalysisQueueService queueService,
                                      JobRunCoordinator jobRunCoordinator) {
        @SuppressWarnings("unchecked")
        ObjectProvider<Boss> bossProvider = mock(ObjectProvider.class);
        return new BossController(
                mock(BossJobService.class),
                mock(PlaywrightManager.class),
                mock(CookieService.class),
                jobRunCoordinator,
                mock(ConfigService.class),
                bossProvider,
                bossService,
                profileService,
                mock(JobAiAnalysisService.class),
                queueService,
                mock(Environment.class)
        );
    }

    private ChromeJobDto chromeJob(String id, String company, String title) {
        ChromeJobDto dto = new ChromeJobDto();
        dto.setId(id);
        dto.setCompany(company);
        dto.setTitle(title);
        dto.setUrl("https://www.zhipin.com/job_detail/" + id + ".html");
        return dto;
    }

    private BossJobDataEntity savedJob(Long id, ChromeJobDto dto, String status) {
        BossJobDataEntity entity = new BossJobDataEntity();
        entity.setId(id);
        entity.setProfileId(1L);
        entity.setEncryptId(dto.getId());
        entity.setCompanyName(dto.getCompany());
        entity.setJobName(dto.getTitle());
        entity.setJobUrl(dto.getUrl());
        entity.setDeliveryStatus(status);
        return entity;
    }
}
