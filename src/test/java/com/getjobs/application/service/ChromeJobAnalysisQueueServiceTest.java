package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.nio.file.Path;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doCallRealMethod;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.spy;

class ChromeJobAnalysisQueueServiceTest {
    @TempDir
    Path tempDir;

    private JdbcTemplate jdbcTemplate;
    private JobAnalysisTaskStore store;
    private JobAiAnalysisService analysisService;
    private ChromeJobAnalysisQueueService queue;

    @BeforeEach
    void setUp() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:sqlite:" + tempDir.resolve("queue.db").toAbsolutePath());
        Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        jdbcTemplate = new JdbcTemplate(dataSource);
        store = new JobAnalysisTaskStore(
                jdbcTemplate,
                new DataSourceTransactionManager(dataSource),
                new ObjectMapper()
        );
        store.validateSchema();
        analysisService = mock(JobAiAnalysisService.class);
    }

    @AfterEach
    void tearDown() {
        if (queue != null) queue.shutdown();
    }

    @Test
    void duplicateEnqueueInvokesProviderOnlyOnce() {
        when(analysisService.analyzeJob(any(), any(), any())).thenReturn(successResult());
        queue = new ChromeJobAnalysisQueueService(analysisService, store);
        ChromeJobAnalysisQueueService.AnalysisJob job = job(request("boss", "job-duplicate", "run-a"));

        ChromeJobAnalysisQueueService.EnqueueResult first = queue.enqueue(job);
        ChromeJobAnalysisQueueService.EnqueueResult duplicate = queue.enqueue(
                job(request("boss", "job-duplicate", "run-b")));

        assertThat(first.isQueued()).isTrue();
        assertThat(duplicate.isQueued()).isFalse();
        verify(analysisService, timeout(3000).times(1)).analyzeJob(any(), any(), any());
        awaitStatus(firstTaskId(), "SUCCEEDED");
    }

    @Test
    void startupDispatchesPersistedPendingTask() {
        long taskId = store.submit(request("boss", "job-restart", "run-before-restart")).task().id();
        when(analysisService.analyzeJob(any(), any(), any())).thenReturn(successResult());
        queue = new ChromeJobAnalysisQueueService(analysisService, store);

        queue.initialize();

        verify(analysisService, timeout(3000).times(1)).analyzeJob(any(), any(), any());
        awaitStatus(taskId, "SUCCEEDED");
        assertThat(store.findById(taskId).attemptCount()).isEqualTo(1);
    }

    @Test
    void expiredLeaseWithPersistedPlatformResultIsReconciledWithoutProviderCall() {
        long taskId = leaseExpiredTask("boss", "job-reconciled");
        when(analysisService.inspectPlatformAnalysis(any()))
                .thenReturn(new JobAiAnalysisService.PlatformAnalysisState(true, false, DeliveryStatus.WAITING_CONFIRM));
        queue = new ChromeJobAnalysisQueueService(analysisService, store);

        queue.reconcileExpiredLeases();

        assertThat(store.findById(taskId).status()).isEqualTo("SUCCEEDED");
        verify(analysisService, never()).analyzeJob(any(), any(), any());
        verify(analysisService, never()).markAnalysisInterrupted(any(), any());
    }

    @Test
    void expiredUnresolvedLeaseBecomesUnknownAndDoesNotRetryProvider() {
        long taskId = leaseExpiredTask("zhilian", "job-unknown");
        when(analysisService.inspectPlatformAnalysis(any()))
                .thenReturn(JobAiAnalysisService.PlatformAnalysisState.incomplete(DeliveryStatus.AI_ANALYZING));
        when(analysisService.markAnalysisInterrupted(any(), any())).thenReturn(true);
        queue = new ChromeJobAnalysisQueueService(analysisService, store);

        queue.reconcileExpiredLeases();

        assertThat(store.findById(taskId).status()).isEqualTo("UNKNOWN");
        verify(analysisService, never()).analyzeJob(any(), any(), any());
        verify(analysisService).markAnalysisInterrupted(any(), any());
    }

    @Test
    void startupRegistersLegacyAnalyzingRowAsUnknownWithoutProviderCall() {
        jdbcTemplate.update("INSERT INTO profile(id, name, is_active) VALUES (1, 'profile', 1)");
        jdbcTemplate.update("INSERT INTO boss_data(id, profile_id, encrypt_id, company_name, job_name, " +
                        "delivery_status, job_description, scan_run_id) VALUES " +
                        "(30, 1, 'legacy-analyzing', '测试公司', 'Java 工程师', ?, '岗位描述', 'legacy-run')",
                DeliveryStatus.AI_ANALYZING);
        when(analysisService.markAnalysisInterrupted(any(), any())).thenReturn(true);
        queue = new ChromeJobAnalysisQueueService(analysisService, store);

        queue.initialize();
        queue.recoverOrphanedAnalyzingTasks();

        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM job_analysis_task WHERE platform='boss' AND job_row_id=30",
                String.class)).isEqualTo("UNKNOWN");
        verify(analysisService, never()).analyzeJob(any(), any(), any());
        verify(analysisService, times(1)).markAnalysisInterrupted(any(), any());
    }

    @Test
    void unexpectedExecutionFailureWritesExplicitTaskAndPlatformFailure() {
        when(analysisService.analyzeJob(any(), any(), any())).thenThrow(new IllegalStateException("executor failed"));
        when(analysisService.inspectPlatformAnalysis(any()))
                .thenReturn(JobAiAnalysisService.PlatformAnalysisState.incomplete(DeliveryStatus.AI_ANALYZING));
        when(analysisService.markAnalysisInterrupted(any(), any())).thenReturn(true);
        queue = new ChromeJobAnalysisQueueService(analysisService, store);

        ChromeJobAnalysisQueueService.EnqueueResult submitted = queue.enqueue(
                job(request("boss", "job-exception", "run-a")));

        awaitStatus(submittedTaskId("job-exception"), "FAILED");
        verify(analysisService).markAnalysisInterrupted(any(), any());
    }

    @Test
    void completionWriteExceptionReconcilesPersistedPlatformSuccess() {
        JobAnalysisTaskStore flakyStore = spy(store);
        doThrow(new IllegalStateException("first completion write failed"))
                .doCallRealMethod()
                .when(flakyStore)
                .complete(anyLong(), anyString(), anyBoolean(), anyString());
        when(analysisService.analyzeJob(any(), any(), any())).thenReturn(successResult());
        when(analysisService.inspectPlatformAnalysis(any()))
                .thenReturn(new JobAiAnalysisService.PlatformAnalysisState(
                        true, false, DeliveryStatus.WAITING_CONFIRM));
        queue = new ChromeJobAnalysisQueueService(analysisService, flakyStore);

        queue.enqueue(job(request("boss", "job-completion-recovery", "run-a")));

        awaitStatus(submittedTaskId("job-completion-recovery"), "SUCCEEDED");
        verify(analysisService, timeout(3000).times(1)).analyzeJob(any(), any(), any());
    }

    @Test
    void providerUnknownOutcomeStopsWithoutAutomaticDuplicateCall() {
        JobAiAnalysisService.AnalysisResult unknown = JobAiAnalysisService.AnalysisResult.failed(
                DeliveryStatus.AI_ANALYSIS_FAILED,
                "provider timeout"
        );
        unknown.setErrorCode("AI_PROVIDER_TIMEOUT");
        unknown.setProviderOutcomeUnknown(true);
        when(analysisService.analyzeJob(any(), any(), any())).thenReturn(unknown);
        queue = new ChromeJobAnalysisQueueService(analysisService, store);

        ChromeJobAnalysisQueueService.EnqueueResult submitted = queue.enqueue(
                job(request("boss", "job-provider-unknown", "run-a")));

        long taskId = submittedTaskId("job-provider-unknown");
        awaitStatus(taskId, "UNKNOWN");
        assertThat(store.findById(taskId).lastError()).contains("provider timeout");
        verify(analysisService, timeout(3000).times(1)).analyzeJob(any(), any(), any());
        queue.initialize();
        verify(analysisService, times(1)).analyzeJob(any(), any(), any());
    }

    @Test
    void confirmedUnknownRetryResetsAnalyzingStatusBeforeCallingProviderAgain() {
        long taskId = store.submit(request("boss", "job-confirmed-retry", "run-a")).task().id();
        assertThat(store.claim(taskId, "lease-unknown", Duration.ofMinutes(1))).isNotNull();
        assertThat(store.completeUnknown(taskId, "lease-unknown", "provider result unknown")).isTrue();
        when(analysisService.inspectPlatformAnalysis(any()))
                .thenReturn(JobAiAnalysisService.PlatformAnalysisState.incomplete(DeliveryStatus.AI_ANALYZING));
        when(analysisService.markAnalysisInterrupted(any(), any())).thenReturn(true);
        when(analysisService.analyzeJob(any(), any(), any())).thenReturn(successResult());
        queue = new ChromeJobAnalysisQueueService(analysisService, store);

        JobAnalysisTaskStore.RetryResult retried = queue.retry(taskId, 1L, true);

        assertThat(retried.accepted()).isTrue();
        verify(analysisService).markAnalysisInterrupted(any(), any());
        verify(analysisService, timeout(3000).times(1)).analyzeJob(any(), any(), any());
        awaitStatus(taskId, "SUCCEEDED");
    }

    @Test
    void confirmedUnknownRetryFailsClosedWhenAnalyzingStatusCannotBeReset() {
        long taskId = store.submit(request("boss", "job-reset-rejected", "run-a")).task().id();
        assertThat(store.claim(taskId, "lease-unknown", Duration.ofMinutes(1))).isNotNull();
        assertThat(store.completeUnknown(taskId, "lease-unknown", "provider result unknown")).isTrue();
        when(analysisService.inspectPlatformAnalysis(any()))
                .thenReturn(JobAiAnalysisService.PlatformAnalysisState.incomplete(DeliveryStatus.AI_ANALYZING));
        when(analysisService.markAnalysisInterrupted(any(), any())).thenReturn(false);
        queue = new ChromeJobAnalysisQueueService(analysisService, store);

        JobAnalysisTaskStore.RetryResult retried = queue.retry(taskId, 1L, true);

        assertThat(retried.accepted()).isFalse();
        assertThat(retried.message()).contains("未重新调用 AI Provider");
        assertThat(store.findById(taskId).status()).isEqualTo("UNKNOWN");
        verify(analysisService, never()).analyzeJob(any(), any(), any());
    }

    private long leaseExpiredTask(String platform, String jobKey) {
        long taskId = store.submit(request(platform, jobKey, "run-a")).task().id();
        assertThat(store.claim(taskId, "expired-lease", Duration.ofMinutes(1))).isNotNull();
        jdbcTemplate.update(
                "UPDATE job_analysis_task SET lease_expires_at='2000-01-01 00:00:00' WHERE id=?",
                taskId
        );
        return taskId;
    }

    private long firstTaskId() {
        return jdbcTemplate.queryForObject(
                "SELECT id FROM job_analysis_task WHERE task_key IS NOT NULL ORDER BY id LIMIT 1",
                Long.class
        );
    }

    private long submittedTaskId(String jobKey) {
        return jdbcTemplate.queryForObject(
                "SELECT id FROM job_analysis_task WHERE job_key=? ORDER BY id DESC LIMIT 1",
                Long.class,
                jobKey
        );
    }

    private void awaitStatus(long taskId, String expected) {
        long deadline = System.currentTimeMillis() + 3000;
        while (System.currentTimeMillis() < deadline) {
            if (expected.equals(store.findById(taskId).status())) return;
            try {
                Thread.sleep(20);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AssertionError("等待任务状态时被中断", e);
            }
        }
        assertThat(store.findById(taskId).status()).isEqualTo(expected);
    }

    private ChromeJobAnalysisQueueService.AnalysisJob job(JobAiAnalysisService.JobAnalysisRequest request) {
        ChromeJobAnalysisQueueService.AnalysisJob job = new ChromeJobAnalysisQueueService.AnalysisJob();
        job.setRunId(request.getScanRunId());
        job.setCurrentStatus(DeliveryStatus.NOT_DELIVERED);
        job.setCurrent(1);
        job.setTotal(1);
        job.setRequest(request);
        return job;
    }

    private JobAiAnalysisService.JobAnalysisRequest request(String platform, String jobKey, String runId) {
        JobAiAnalysisService.JobAnalysisRequest request = new JobAiAnalysisService.JobAnalysisRequest();
        request.setProfileId(1L);
        request.setPlatform(platform);
        request.setJobKey(jobKey);
        request.setJobRowId("boss".equals(platform) ? 10L : 20L);
        request.setKeyword("Java");
        request.setCompanyName("测试公司");
        request.setJobName("Java 工程师");
        request.setSalary("20-30K");
        request.setLocation("深圳");
        request.setExperience("3-5年");
        request.setDegree("本科");
        request.setCompanyInfo("互联网");
        request.setJobDescription("负责 Spring Boot 服务开发");
        request.setScanRunId(runId);
        return request;
    }

    private JobAiAnalysisService.AnalysisResult successResult() {
        JobAiAnalysisService.AnalysisResult result = new JobAiAnalysisService.AnalysisResult();
        result.setScore(90);
        result.setDecision("APPLY");
        result.setSummary("匹配");
        return result;
    }
}
