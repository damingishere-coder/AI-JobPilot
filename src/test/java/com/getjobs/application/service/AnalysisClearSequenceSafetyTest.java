package com.getjobs.application.service;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AnalysisClearSequenceSafetyTest {
    @TempDir
    Path tempDir;

    @Test
    void clearingAnalysisPreservesAttemptHistoryAndDoesNotReuseBossOrZhilianRowIds() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:sqlite:" + tempDir.resolve("clear-safety.db").toAbsolutePath());
        Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.update("INSERT INTO profile(id, name, is_active) VALUES (1, 'profile', 1)");
        jdbcTemplate.update("INSERT INTO boss_data(id, profile_id, encrypt_id, delivery_status) VALUES (10, 1, 'boss-old', '投递结果待确认')");
        jdbcTemplate.update("INSERT INTO zhilian_data(id, profile_id, job_id, delivery_status) VALUES (20, 1, 'zhilian-old', '投递结果待确认')");
        jdbcTemplate.update("INSERT INTO delivery_attempt " +
                        "(request_key, platform, profile_id, job_key, job_row_id, state, requested_at, updated_at) " +
                        "VALUES ('boss-old-attempt', 'boss', 1, 'boss-old', 10, 'UNKNOWN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), " +
                        "('zhilian-old-attempt', 'zhilian', 1, 'zhilian-old', 20, 'UNKNOWN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
        jdbcTemplate.update("INSERT INTO job_analysis_task " +
                        "(profile_id, platform, status, task_key, job_key, job_row_id, request_json, created_at, updated_at) " +
                        "VALUES (1, 'boss', 'PENDING', 'boss-ai-old', 'boss-old', 10, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), " +
                        "(1, 'zhilian', 'FAILED', 'zhilian-ai-old', 'zhilian-old', 20, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");

        ProfileService profileService = mock(ProfileService.class);
        when(profileService.getCurrentProfileId()).thenReturn(1L);
        BossService bossService = new BossService(null, null, null, null, null, dataSource, profileService);
        ZhilianService zhilianService = new ZhilianService(null, null, null, dataSource, profileService);

        assertThat(bossService.clearBossAnalysisData()).containsEntry("success", true);
        assertThat(zhilianService.clearZhilianAnalysisData()).containsEntry("success", true);
        jdbcTemplate.update("INSERT INTO boss_data(profile_id, encrypt_id, delivery_status) VALUES (1, 'boss-new', '待确认')");
        jdbcTemplate.update("INSERT INTO zhilian_data(profile_id, job_id, delivery_status) VALUES (1, 'zhilian-new', '待确认')");

        assertThat(jdbcTemplate.queryForObject("SELECT id FROM boss_data WHERE encrypt_id='boss-new'", Long.class))
                .isGreaterThan(10L);
        assertThat(jdbcTemplate.queryForObject("SELECT id FROM zhilian_data WHERE job_id='zhilian-new'", Long.class))
                .isGreaterThan(20L);
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM delivery_attempt", Integer.class))
                .isEqualTo(2);
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM job_analysis_task WHERE task_key IS NOT NULL", Integer.class))
                .isZero();
    }

    @Test
    void clearingAnalysisIsBlockedWhileAiTaskLeaseIsActive() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:sqlite:" + tempDir.resolve("clear-active-lease.db").toAbsolutePath());
        Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.update("INSERT INTO profile(id, name, is_active) VALUES (1, 'profile', 1)");
        jdbcTemplate.update("INSERT INTO boss_data(id, profile_id, encrypt_id, delivery_status) " +
                "VALUES (10, 1, 'boss-active', 'AI分析中')");
        jdbcTemplate.update("INSERT INTO job_analysis_task " +
                        "(profile_id, platform, status, task_key, job_key, job_row_id, request_json, " +
                        "lease_owner, lease_expires_at, created_at, updated_at) " +
                        "VALUES (1, 'boss', 'LEASED', 'boss-ai-active', 'boss-active', 10, '{}', " +
                        "'lease', '2099-01-01 00:00:00', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");

        ProfileService profileService = mock(ProfileService.class);
        when(profileService.getCurrentProfileId()).thenReturn(1L);
        BossService bossService = new BossService(null, null, null, null, null, dataSource, profileService);

        assertThat(bossService.clearBossAnalysisData())
                .containsEntry("success", false);
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM boss_data", Integer.class)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM job_analysis_task WHERE status='LEASED'", Integer.class))
                .isEqualTo(1);
    }
}
