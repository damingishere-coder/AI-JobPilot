package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JobAnalysisTaskStoreTest {
    @TempDir
    Path tempDir;

    private JdbcTemplate jdbcTemplate;
    private JobAnalysisTaskStore store;

    @BeforeEach
    void setUp() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:sqlite:" + tempDir.resolve("analysis-task.db").toAbsolutePath());
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
    }

    @Test
    void stableTaskKeyDeduplicatesAcrossRunIdsButSeparatesProfiles() {
        JobAnalysisTaskStore.SubmitResult first = store.submit(request(1L, "boss", "job-1", "run-a"));
        JobAnalysisTaskStore.SubmitResult duplicate = store.submit(request(1L, "boss", "job-1", "run-b"));
        JobAnalysisTaskStore.SubmitResult otherProfile = store.submit(request(2L, "boss", "job-1", "run-b"));

        assertThat(first.created()).isTrue();
        assertThat(duplicate.created()).isFalse();
        assertThat(duplicate.task().id()).isEqualTo(first.task().id());
        assertThat(otherProfile.created()).isTrue();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM job_analysis_task WHERE task_key IS NOT NULL", Integer.class)).isEqualTo(2);
    }

    @Test
    void rejectsTaskWhoseProfileOrJobKeyDoesNotMatchTargetRow() {
        JobAiAnalysisService.JobAnalysisRequest wrongJobKey = request(1L, "boss", "job-real", "run-a");
        wrongJobKey.setJobKey("job-other");

        assertThatThrownBy(() -> store.submit(wrongJobKey))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("目标岗位不一致");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM job_analysis_task WHERE task_key IS NOT NULL", Integer.class)).isZero();
    }

    @Test
    void rejectsPersistedTaskWhenItsIndexedIdentityNoLongerMatchesSnapshot() {
        JobAnalysisTaskStore.SubmitResult submitted = store.submit(request(1L, "boss", "job-real", "run-a"));
        jdbcTemplate.update("UPDATE job_analysis_task SET job_key='job-corrupted' WHERE id=?", submitted.task().id());

        assertThatThrownBy(() -> store.deserialize(store.findById(submitted.task().id())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("任务快照与任务索引不一致");
    }

    @Test
    void concurrentConsumersCanOnlyClaimOnce() throws Exception {
        long taskId = store.submit(request(1L, "boss", "job-claim", "run-a")).task().id();
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<Boolean> first = executor.submit(() -> claimAfterBarrier(taskId, "lease-a", ready, start));
            Future<Boolean> second = executor.submit(() -> claimAfterBarrier(taskId, "lease-b", ready, start));
            ready.await();
            start.countDown();

            assertThat(List.of(first.get(), second.get())).containsExactlyInAnyOrder(true, false);
            assertThat(store.findById(taskId).attemptCount()).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void failedAndUnknownTasksRequireExplicitRetryAndIncrementAttemptsOnClaim() {
        long failedId = store.submit(request(1L, "boss", "job-failed", "run-a")).task().id();
        assertThat(store.claim(failedId, "lease-failed", Duration.ofMinutes(1))).isNotNull();
        assertThat(store.renewLease(failedId, "wrong-lease", Duration.ofMinutes(1))).isFalse();
        assertThat(store.renewLease(failedId, "lease-failed", Duration.ofMinutes(1))).isTrue();
        assertThat(store.complete(failedId, "lease-failed", true, "provider failed")).isTrue();
        assertThat(store.retry(failedId, 1L).accepted()).isTrue();
        assertThat(store.claim(failedId, "lease-retry", Duration.ofMinutes(1))).isNotNull();
        assertThat(store.findById(failedId).attemptCount()).isEqualTo(2);
        assertThat(store.complete(failedId, "lease-retry", false, "ok")).isTrue();
        assertThat(store.retry(failedId, 1L).accepted()).isFalse();

        long unknownId = store.submit(request(1L, "zhilian", "job-unknown", "run-a")).task().id();
        assertThat(store.claim(unknownId, "lease-unknown", Duration.ofMinutes(1))).isNotNull();
        jdbcTemplate.update("UPDATE job_analysis_task SET lease_expires_at='2000-01-01 00:00:00' WHERE id=?", unknownId);
        assertThat(store.reconcileExpired(
                unknownId,
                "lease-unknown",
                JobAnalysisTaskStore.Status.UNKNOWN,
                "result unknown"
        )).isTrue();
        assertThat(store.retry(unknownId, 2L, true).accepted()).isFalse();
        assertThat(store.retry(unknownId, 1L).accepted()).isFalse();
        assertThat(store.retry(unknownId, 1L, true).accepted()).isTrue();
        assertThat(store.findById(unknownId).status()).isEqualTo("PENDING");
    }

    @Test
    void leaseHeartbeatStopsAtHardExecutionLimitAndTaskCanExpire() {
        long taskId = store.submit(request(1L, "boss", "job-hard-timeout", "run-a")).task().id();
        assertThat(store.claim(taskId, "lease-hard-timeout", Duration.ofMinutes(5))).isNotNull();
        jdbcTemplate.update("UPDATE job_analysis_task SET started_at='2000-01-01 00:00:00.000', " +
                        "lease_expires_at='2000-01-01 00:00:01.000' WHERE id=?",
                taskId);
        AtomicBoolean writeExecuted = new AtomicBoolean();

        assertThat(store.renewLease(taskId, "lease-hard-timeout", Duration.ofMinutes(5))).isFalse();
        assertThat(store.isLeaseOwner(taskId, "lease-hard-timeout")).isFalse();
        assertThat(store.executeWithLease(taskId, "lease-hard-timeout", () -> writeExecuted.set(true))).isFalse();
        assertThat(writeExecuted).isFalse();
        assertThat(store.complete(taskId, "lease-hard-timeout", false, "late result")).isFalse();
        assertThat(store.listExpiredLeases(10)).extracting(JobAnalysisTaskStore.TaskRecord::id)
                .contains(taskId);
    }

    @Test
    void currentLeaseCanCompleteUnknownAndRequiresConfirmedRetry() {
        long taskId = store.submit(request(1L, "boss", "job-provider-timeout", "run-a")).task().id();
        assertThat(store.claim(taskId, "lease-provider-timeout", Duration.ofMinutes(1))).isNotNull();

        assertThat(store.completeUnknown(taskId, "wrong-lease", "provider result unknown")).isFalse();
        assertThat(store.completeUnknown(
                taskId,
                "lease-provider-timeout",
                "provider result unknown"
        )).isTrue();

        JobAnalysisTaskStore.TaskRecord task = store.findById(taskId);
        assertThat(task.status()).isEqualTo("UNKNOWN");
        assertThat(task.completedAt()).isNull();
        assertThat(task.leaseExpiresAt()).isNull();
        assertThat(task.lastError()).contains("provider result unknown");
        assertThat(store.retry(taskId, 1L).accepted()).isFalse();
        assertThat(store.retry(taskId, 1L, true).accepted()).isTrue();
    }

    private boolean claimAfterBarrier(long taskId,
                                      String lease,
                                      CountDownLatch ready,
                                      CountDownLatch start) throws Exception {
        ready.countDown();
        start.await();
        return store.claim(taskId, lease, Duration.ofMinutes(1)) != null;
    }

    private JobAiAnalysisService.JobAnalysisRequest request(long profileId,
                                                            String platform,
                                                            String jobKey,
                                                            String runId) {
        JobAiAnalysisService.JobAnalysisRequest request = new JobAiAnalysisService.JobAnalysisRequest();
        request.setProfileId(profileId);
        request.setPlatform(platform);
        request.setJobKey(jobKey);
        jdbcTemplate.update("INSERT OR IGNORE INTO profile(id, name, is_active) VALUES (?, ?, 0)",
                profileId, "profile-" + profileId);
        if ("boss".equals(platform)) {
            jdbcTemplate.update("INSERT OR IGNORE INTO boss_data(profile_id, encrypt_id, company_name, job_name, delivery_status) " +
                            "VALUES (?, ?, '测试公司', 'Java 工程师', ?)",
                    profileId, jobKey, DeliveryStatus.NOT_DELIVERED);
            request.setJobRowId(jdbcTemplate.queryForObject(
                    "SELECT id FROM boss_data WHERE profile_id=? AND encrypt_id=?", Long.class, profileId, jobKey));
        } else {
            jdbcTemplate.update("INSERT OR IGNORE INTO zhilian_data(profile_id, job_id, company_name, job_title, delivery_status) " +
                            "VALUES (?, ?, '测试公司', 'Java 工程师', ?)",
                    profileId, jobKey, DeliveryStatus.NOT_DELIVERED);
            request.setJobRowId(jdbcTemplate.queryForObject(
                    "SELECT id FROM zhilian_data WHERE profile_id=? AND job_id=?", Long.class, profileId, jobKey));
        }
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
}
