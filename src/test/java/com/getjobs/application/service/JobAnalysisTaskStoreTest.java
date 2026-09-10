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
    void zhilianTaskKeyIncludesCurrentIntroductionButBossKeyIsUnchanged() {
        var first = store.submit(request(4L, "zhilian", "job-intro", "run-a"));
        var boss = store.submit(request(4L, "boss", "boss-intro", "run-a"));
        jdbcTemplate.update("INSERT INTO ai(profile_id,introduce) VALUES(4,'新增AI产品运营项目')");
        var whileActive = store.submit(request(4L, "zhilian", "job-intro", "run-b"));
        assertThat(whileActive.task().id()).isEqualTo(first.task().id());
        jdbcTemplate.update("UPDATE job_analysis_task SET status='SUCCEEDED' WHERE id IN (?,?)", first.task().id(), boss.task().id());
        var second = store.submit(request(4L, "zhilian", "job-intro", "run-b"));
        var bossAgain = store.submit(request(4L, "boss", "boss-intro", "run-b"));
        assertThat(second.created()).isTrue();
        assertThat(second.task().id()).isNotEqualTo(first.task().id());
        assertThat(bossAgain.task().id()).isEqualTo(boss.task().id());
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
        assertThat(jdbcTemplate.queryForObject(
                "SELECT task_key FROM job_analysis_task WHERE id=?", String.class, first.task().id()))
                .startsWith("ai:v2:");
    }

    @Test
    void additiveFilterMigrationPreservesConfigAndIsolatesProgressByProfile() {
        jdbcTemplate.update("INSERT INTO zhilian_config(profile_id,keywords,city_code,salary,search_job_limit) VALUES(4,'AI产品运营','765','0000,9999999',30)");
        assertThat(jdbcTemplate.queryForObject("SELECT filters_json FROM zhilian_config WHERE profile_id=4",String.class)).isEqualTo("{}");
        var filters = new com.getjobs.application.dto.ZhilianFilters();filters.setEducation(List.of("4"));
        var config = new com.getjobs.application.entity.ZhilianConfigEntity();config.setFilters(filters);
        jdbcTemplate.update("UPDATE zhilian_config SET filters_json=? WHERE profile_id=4", config.getFiltersJson());
        config.setFiltersJson(jdbcTemplate.queryForObject("SELECT filters_json FROM zhilian_config WHERE profile_id=4",String.class));
        assertThat(config.getFilters()).isEqualTo(filters);
        assertThat(jdbcTemplate.queryForObject("SELECT search_job_limit FROM zhilian_config WHERE profile_id=4",Integer.class)).isEqualTo(30);
        var req=request(4L,"zhilian","progress-job","progress-run");
        jdbcTemplate.update("UPDATE zhilian_data SET scan_run_id=? WHERE id=?","progress-run",req.getJobRowId());
        assertThat(store.submit(req).accepted()).isTrue();
        assertThat(((Number)store.zhilianRunProgress(4L,"progress-run").get("enqueued")).intValue()).isEqualTo(1);
        assertThat(((Number)store.zhilianRunProgress(5L,"progress-run").get("collected")).intValue()).isZero();
        jdbcTemplate.update("UPDATE zhilian_data SET scan_run_id=? WHERE id=?", "later-run", req.getJobRowId());
        assertThat(((Number)store.zhilianRunProgress(4L,"later-run").get("enqueued")).intValue()).isZero();
    }

    @Test
    void concurrentProducersAndConsumerNeverLoseOrDuplicateTasks() throws Exception {
        var requests = new java.util.ArrayList<JobAiAnalysisService.JobAnalysisRequest>();
        for (int i = 0; i < 30; i++) requests.add(request(1L, "zhilian", "concurrent-" + i, "run-concurrent"));
        try (ExecutorService pool = Executors.newFixedThreadPool(8)) {
            var results = new java.util.ArrayList<Future<JobAnalysisTaskStore.SubmitResult>>();
            CountDownLatch start = new CountDownLatch(1);
            for (var request : requests) {
                for (int copy = 0; copy < 2; copy++) {
                    results.add(pool.submit(() -> { start.await(); return store.submit(request); }));
                }
            }
            start.countDown();
            for (var future : results) {
                var result = future.get();
                assertThat(result.accepted()).as(result.message()).isTrue();
                if (result.created()) {
                    var claimed = store.claim(result.task().id(), "consumer", Duration.ofMinutes(1));
                    if (claimed != null) store.complete(claimed.id(), "consumer", false, "done");
                }
            }
        }
        assertThat(jdbcTemplate.queryForObject("SELECT count(*) FROM job_analysis_task", Integer.class)).isEqualTo(30);
    }

    @Test
    void retriesTransientLockInFreshTransactionAndKeepsOtherFailuresVisible() throws Exception {
        var request = request(1L, "zhilian", "locked", "run-lock");
        var original = jdbcTemplate.getDataSource();
        var retryJdbc = new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:" + tempDir.resolve("analysis-task.db") + "?busy_timeout=10"));
        var retryStore = new JobAnalysisTaskStore(retryJdbc, new DataSourceTransactionManager(retryJdbc.getDataSource()), new ObjectMapper());
        try (var connection = original.getConnection(); var statement = connection.createStatement(); var pool = Executors.newSingleThreadExecutor()) {
            statement.execute("BEGIN IMMEDIATE");
            statement.execute("UPDATE job_analysis_task SET id=id WHERE id=-1");
            var result = pool.submit(() -> retryStore.submit(request));
            Thread.sleep(180);
            statement.execute("COMMIT");
            assertThat(result.get().accepted()).isTrue();
        }
        assertThat(JobAnalysisTaskStore.isTransientSqliteLock(new java.sql.SQLException("busy snapshot", "", 517))).isTrue();
        assertThat(JobAnalysisTaskStore.isTransientSqliteLock(new java.sql.SQLException("constraint", "", 19))).isFalse();
        jdbcTemplate.execute("CREATE TRIGGER reject_tasks BEFORE INSERT ON job_analysis_task BEGIN SELECT RAISE(ABORT, 'test storage failure'); END");
        var failed = store.submit(request(1L, "zhilian", "broken", "run-lock"));
        assertThat(failed.accepted()).isFalse();
        assertThat(failed.errorCode()).isEqualTo("PERSISTENCE_ERROR");
        assertThat(failed.retryable()).isFalse();
    }

    @Test
    void compatibleBatchSelectionKeepsProfileAndPlatformIsolated() {
        store.submit(request(1L, "boss", "boss-one", "run-a"));
        store.submit(request(1L, "boss", "boss-two", "run-a"));
        store.submit(request(1L, "zhilian", "zhilian-one", "run-a"));
        store.submit(request(2L, "boss", "boss-other-profile", "run-a"));

        List<JobAnalysisTaskStore.TaskRecord> compatible =
                store.listCompatibleDuePending(1L, "BOSS", 4);

        assertThat(compatible).hasSize(2);
        assertThat(compatible).extracting(JobAnalysisTaskStore.TaskRecord::profileId).containsOnly(1L);
        assertThat(compatible).extracting(JobAnalysisTaskStore.TaskRecord::platform).containsOnly("boss");
        assertThat(store.pendingCount(1L)).isEqualTo(3);
        assertThat(store.pendingCount(1L, "boss")).isEqualTo(2);
        assertThat(store.pendingCount(1L, "zhilian")).isEqualTo(1);
        assertThat(store.outstandingCount(1L, "boss")).isEqualTo(2);
        assertThat(store.listRecent(1L, "boss", 10))
                .extracting(JobAnalysisTaskStore.TaskView::platform)
                .containsOnly("boss");
        assertThat(store.processingCount(1L)).isZero();
    }

    @Test
    void changedResumeCreatesAFreshV2TaskForTheSameJob() {
        JobAiAnalysisService.JobAnalysisRequest initialRequest = request(1L, "boss", "job-resume", "run-a");
        jdbcTemplate.update("INSERT INTO resume_profile(profile_id, resume_text, updated_at) VALUES (?, ?, ?)",
                1L, "三年 Java 经验", "2026-09-03 10:00:00.000");
        JobAnalysisTaskStore.SubmitResult first = store.submit(initialRequest);
        assertThat(store.claim(first.task().id(), "lease-first", Duration.ofMinutes(1))).isNotNull();
        assertThat(store.complete(first.task().id(), "lease-first", false, "ok")).isTrue();

        jdbcTemplate.update("UPDATE resume_profile SET resume_text=?, updated_at=? WHERE profile_id=?",
                "五年 Java 与 Spring Boot 经验", "2026-09-03 10:01:00.000", 1L);
        JobAnalysisTaskStore.SubmitResult second = store.submit(request(1L, "boss", "job-resume", "run-b"));

        assertThat(second.created()).isTrue();
        assertThat(second.task().id()).isNotEqualTo(first.task().id());
        String firstTaskKey = jdbcTemplate.queryForObject(
                "SELECT task_key FROM job_analysis_task WHERE id=?", String.class, first.task().id());
        String secondTaskKey = jdbcTemplate.queryForObject(
                "SELECT task_key FROM job_analysis_task WHERE id=?", String.class, second.task().id());
        assertThat(secondTaskKey).isNotEqualTo(firstTaskKey);
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
