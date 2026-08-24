package com.getjobs.application.service;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class DeliveryAttemptServiceTest {
    @TempDir
    Path tempDir;

    private JdbcTemplate jdbcTemplate;
    private DeliveryAttemptService service;

    @BeforeEach
    void setUp() {
        String url = "jdbc:sqlite:" + tempDir.resolve("delivery.db").toAbsolutePath();
        DriverManagerDataSource dataSource = new DriverManagerDataSource(url);
        Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        jdbcTemplate = new JdbcTemplate(dataSource);
        service = new DeliveryAttemptService(jdbcTemplate, new DataSourceTransactionManager(dataSource));
        service.validateSchema();
        jdbcTemplate.update("INSERT INTO profile(id, name, is_active) VALUES (1, 'profile', 1)");
    }

    @Test
    void confirmedAttemptIsIdempotentAndRejectsLateFailure() {
        insertBoss(10, DeliveryStatus.WAITING_CONFIRM);

        DeliveryAttemptService.RequestResult requested = service.requestBoss(10, 1, "boss-10", false);
        assertThat(requested.created()).isTrue();
        assertThat(status("boss_data", 10)).isEqualTo(DeliveryStatus.DELIVERY_REQUESTED);

        DeliveryAttemptService.ResolutionResult confirmed = service.resolve(
                "boss", 1L, 10, requested.requestKey(), DeliveryAttemptService.State.CONFIRMED,
                DeliveryAttemptService.PLATFORM_STATUS_TEXT, "页面显示已沟通", null, null);
        DeliveryAttemptService.ResolutionResult duplicate = service.resolve(
                "boss", 1L, 10, requested.requestKey(), DeliveryAttemptService.State.CONFIRMED,
                DeliveryAttemptService.PLATFORM_STATUS_TEXT, "重复回调", null, null);
        DeliveryAttemptService.ResolutionResult lateFailure = service.resolve(
                "boss", 1L, 10, requested.requestKey(), DeliveryAttemptService.State.FAILED,
                DeliveryAttemptService.PLATFORM_ERROR, "延迟失败", "NETWORK_ERROR", "延迟失败");

        assertThat(confirmed.accepted()).isTrue();
        assertThat(duplicate.accepted()).isTrue();
        assertThat(duplicate.idempotent()).isTrue();
        assertThat(lateFailure.accepted()).isFalse();
        assertThat(status("boss_data", 10)).isEqualTo(DeliveryStatus.DELIVERED);
        assertThat(attemptState(requested.requestKey())).isEqualTo("CONFIRMED");
    }

    @Test
    void unknownCanBeReconciledButCannotConfirmWithoutStrongEvidence() {
        insertZhilian(20, DeliveryStatus.WAITING_CONFIRM);
        DeliveryAttemptService.RequestResult requested = service.requestZhilian(20, 1, "zhilian-20");

        DeliveryAttemptService.ResolutionResult unknown = service.resolve(
                "zhilian", 1L, 20, requested.requestKey(), DeliveryAttemptService.State.UNKNOWN,
                DeliveryAttemptService.NO_CONFIRMATION, "响应丢失", null, null);
        assertThat(unknown.accepted()).isTrue();
        assertThat(status("zhilian_data", 20)).isEqualTo(DeliveryStatus.DELIVERY_UNKNOWN);

        DeliveryAttemptService.ResolutionResult weakConfirmation = service.resolve(
                "zhilian", 1L, 20, requested.requestKey(), DeliveryAttemptService.State.CONFIRMED,
                DeliveryAttemptService.CHAT_SURFACE_ONLY, "只有聊天页", null, null);
        DeliveryAttemptService.ResolutionResult forgedManualConfirmation = service.resolve(
                "zhilian", 1L, 20, requested.requestKey(), DeliveryAttemptService.State.CONFIRMED,
                DeliveryAttemptService.MANUAL_RECONCILIATION, "伪造人工证据", null, null);
        DeliveryAttemptService.ResolutionResult confirmed = service.resolve(
                "zhilian", 1L, 20, requested.requestKey(), DeliveryAttemptService.State.CONFIRMED,
                DeliveryAttemptService.PLATFORM_STATUS_TEXT, "页面显示已投递", null, null);

        assertThat(weakConfirmation.accepted()).isFalse();
        assertThat(forgedManualConfirmation.accepted()).isFalse();
        assertThat(confirmed.accepted()).isTrue();
        assertThat(status("zhilian_data", 20)).isEqualTo(DeliveryStatus.DELIVERED);
    }

    @Test
    void duplicateReservationAndMismatchedCallbackAreRejected() {
        insertBoss(30, DeliveryStatus.WAITING_CONFIRM);
        DeliveryAttemptService.RequestResult first = service.requestBoss(30, 1, "boss-30", false);
        DeliveryAttemptService.RequestResult duplicate = service.requestBoss(30, 1, "boss-30", false);

        DeliveryAttemptService.ResolutionResult wrongProfile = service.resolve(
                "boss", 2L, 30, first.requestKey(), DeliveryAttemptService.State.CONFIRMED,
                DeliveryAttemptService.PLATFORM_STATUS_TEXT, "错误档案", null, null);
        DeliveryAttemptService.ResolutionResult missingKey = service.resolve(
                "boss", 1L, 30, null, DeliveryAttemptService.State.FAILED,
                DeliveryAttemptService.PRE_ACTION_ERROR, "无任务绑定", null, null);

        assertThat(first.created()).isTrue();
        assertThat(duplicate.accepted()).isTrue();
        assertThat(duplicate.created()).isFalse();
        assertThat(duplicate.requestKey()).isEqualTo(first.requestKey());
        assertThat(wrongProfile.accepted()).isFalse();
        assertThat(missingKey.accepted()).isFalse();
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM delivery_attempt WHERE job_row_id=30", Integer.class))
                .isEqualTo(1);
        assertThat(status("boss_data", 30)).isEqualTo(DeliveryStatus.DELIVERY_REQUESTED);
    }

    @Test
    void staleAttemptCannotOverwriteANewerAttemptAndFailureIsTerminal() {
        insertBoss(40, DeliveryStatus.WAITING_CONFIRM);
        DeliveryAttemptService.RequestResult first = service.requestBoss(40, 1, "boss-40", false);
        jdbcTemplate.update("UPDATE delivery_attempt SET state='UNKNOWN', updated_at=CURRENT_TIMESTAMP WHERE request_key=?",
                first.requestKey());
        jdbcTemplate.update("INSERT INTO delivery_attempt " +
                        "(request_key, platform, profile_id, job_key, job_row_id, state, requested_at, updated_at) " +
                        "VALUES ('newer-request', 'boss', 1, 'boss-40', 40, 'REQUESTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");

        DeliveryAttemptService.ResolutionResult stale = service.resolve(
                "boss", 1L, 40, first.requestKey(), DeliveryAttemptService.State.CONFIRMED,
                DeliveryAttemptService.PLATFORM_STATUS_TEXT, "旧任务延迟成功", null, null);
        DeliveryAttemptService.ResolutionResult failed = service.resolve(
                "boss", 1L, 40, "newer-request", DeliveryAttemptService.State.FAILED,
                DeliveryAttemptService.PLATFORM_ERROR, "平台明确失败", "PLATFORM_ERROR", "平台明确失败");
        DeliveryAttemptService.ResolutionResult lateSuccess = service.resolve(
                "boss", 1L, 40, "newer-request", DeliveryAttemptService.State.CONFIRMED,
                DeliveryAttemptService.PLATFORM_STATUS_TEXT, "延迟成功", null, null);

        assertThat(stale.accepted()).isFalse();
        assertThat(failed.accepted()).isTrue();
        assertThat(lateSuccess.accepted()).isFalse();
        assertThat(status("boss_data", 40)).isEqualTo(DeliveryStatus.DELIVERY_FAILED);
        assertThat(attemptState("newer-request")).isEqualTo("FAILED");
    }

    @Test
    void unknownCanBeManuallyReconciledAndRetryCreatesANewRequestKey() {
        insertBoss(50, DeliveryStatus.WAITING_CONFIRM);
        DeliveryAttemptService.RequestResult first = service.requestBoss(50, 1, "boss-50", false);
        assertThat(service.resolve(
                "boss", 1L, 50, first.requestKey(), DeliveryAttemptService.State.UNKNOWN,
                DeliveryAttemptService.NO_CONFIRMATION, "响应丢失", null, null).accepted()).isTrue();

        DeliveryAttemptService.RequestResult retry = service.retryBoss(50, 1, "boss-50");

        assertThat(retry.accepted()).isTrue();
        assertThat(retry.created()).isTrue();
        assertThat(retry.requestKey()).isNotEqualTo(first.requestKey());
        DeliveryAttemptService.RequestResult duplicateRetry = service.retryBoss(50, 1, "boss-50");
        assertThat(duplicateRetry.accepted()).isTrue();
        assertThat(duplicateRetry.created()).isFalse();
        assertThat(duplicateRetry.requestKey()).isEqualTo(retry.requestKey());
        assertThat(status("boss_data", 50)).isEqualTo(DeliveryStatus.DELIVERY_REQUESTED);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM delivery_attempt WHERE platform='boss' AND job_row_id=50", Integer.class))
                .isEqualTo(2);

        assertThat(service.resolve(
                "boss", 1L, 50, retry.requestKey(), DeliveryAttemptService.State.UNKNOWN,
                DeliveryAttemptService.NO_CONFIRMATION, "第二次结果未知", null, null).accepted()).isTrue();
        DeliveryAttemptService.ResolutionResult reconciled = service.reconcileLatest(
                "boss", 1L, 50, "boss-50", DeliveryAttemptService.State.CONFIRMED, "人工核对已投递");
        assertThat(reconciled.accepted()).isTrue();
        assertThat(status("boss_data", 50)).isEqualTo(DeliveryStatus.DELIVERED);
    }

    @Test
    void reusedRowIdWithDifferentJobKeyIsRejected() {
        insertBoss(60, DeliveryStatus.WAITING_CONFIRM);
        DeliveryAttemptService.RequestResult first = service.requestBoss(60, 1, "old-job", false);
        assertThat(first.created()).isTrue();
        jdbcTemplate.update("DELETE FROM boss_data WHERE id=60");
        jdbcTemplate.update("INSERT INTO boss_data(id, profile_id, encrypt_id, delivery_status, created_at, updated_at) " +
                "VALUES (60, 1, 'new-job', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", DeliveryStatus.WAITING_CONFIRM);

        DeliveryAttemptService.RequestResult reused = service.requestBoss(60, 1, "new-job", false);

        assertThat(reused.accepted()).isFalse();
        assertThat(reused.message()).contains("历史投递记录不一致");
        assertThat(status("boss_data", 60)).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
    }

    @Test
    void legacyDeliveryIsScopedToCurrentProfileAndCanRecoverFromUnknown() {
        jdbcTemplate.update("INSERT INTO profile(id, name, is_active) VALUES (2, 'other', 0)");
        jdbcTemplate.update("INSERT INTO liepin_data(profile_id, job_id, delivery_status) VALUES (1, 900, ?)",
                DeliveryStatus.NOT_DELIVERED);
        jdbcTemplate.update("INSERT INTO liepin_data(profile_id, job_id, delivery_status) VALUES (2, 900, ?)",
                DeliveryStatus.NOT_DELIVERED);

        DeliveryAttemptService.RequestResult requested = service.requestLegacy("liepin", 900);
        assertThat(requested.created()).isTrue();
        assertThat(service.resolveLegacy(
                "liepin", 900, requested.requestKey(), DeliveryAttemptService.State.UNKNOWN,
                DeliveryAttemptService.NO_CONFIRMATION, "平台结果未落库").accepted()).isTrue();
        assertThat(service.listRecentForCurrentProfile("liepin", 10)).hasSize(1);
        assertThat(service.prepareLegacyRetry("liepin", 900).accepted()).isTrue();

        assertThat(jdbcTemplate.queryForObject(
                "SELECT delivery_status FROM liepin_data WHERE profile_id=1 AND job_id=900", String.class))
                .isEqualTo(DeliveryStatus.NOT_DELIVERED);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT delivery_status FROM liepin_data WHERE profile_id=2 AND job_id=900", String.class))
                .isEqualTo(DeliveryStatus.NOT_DELIVERED);

        DeliveryAttemptService.RequestResult retried = service.requestLegacy("liepin", 900);
        assertThat(retried.created()).isTrue();
        assertThat(retried.requestKey()).isNotEqualTo(requested.requestKey());
        assertThat(service.resolveLegacy(
                "liepin", 900, retried.requestKey(), DeliveryAttemptService.State.CONFIRMED,
                DeliveryAttemptService.PLATFORM_STATUS_TEXT, "平台明确显示已投递").accepted()).isTrue();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT delivery_status FROM liepin_data WHERE profile_id=1 AND job_id=900", String.class))
                .isEqualTo(DeliveryStatus.DELIVERED);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT delivery_status FROM liepin_data WHERE profile_id=2 AND job_id=900", String.class))
                .isEqualTo(DeliveryStatus.NOT_DELIVERED);
    }

    private void insertBoss(long id, String status) {
        jdbcTemplate.update("INSERT INTO boss_data(id, profile_id, encrypt_id, delivery_status, created_at, updated_at) " +
                "VALUES (?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", id, "boss-" + id, status);
    }

    private void insertZhilian(long id, String status) {
        jdbcTemplate.update("INSERT INTO zhilian_data(id, profile_id, job_id, delivery_status, create_time, update_time) " +
                "VALUES (?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", id, "zhilian-" + id, status);
    }

    private String status(String table, long id) {
        return jdbcTemplate.queryForObject("SELECT delivery_status FROM " + table + " WHERE id=?", String.class, id);
    }

    private String attemptState(String requestKey) {
        return jdbcTemplate.queryForObject(
                "SELECT state FROM delivery_attempt WHERE request_key=?", String.class, requestKey);
    }
}
