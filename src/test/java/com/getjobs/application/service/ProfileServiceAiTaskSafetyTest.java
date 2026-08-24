package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.getjobs.application.entity.ProfileEntity;
import com.getjobs.application.mapper.ProfileMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ProfileServiceAiTaskSafetyTest {
    @TempDir
    Path tempDir;

    @Test
    void forceDeleteRollsBackWhenAiTaskLeaseIsActive() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:sqlite:" + tempDir.resolve("profile-delete.db").toAbsolutePath());
        Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.update("INSERT INTO profile(id, name, is_active) VALUES (1, 'active', 1), (2, 'other', 0)");
        jdbcTemplate.update("INSERT INTO boss_data(id, profile_id, encrypt_id, delivery_status) " +
                "VALUES (10, 1, 'boss-active', 'AI分析中')");
        jdbcTemplate.update("INSERT INTO job_analysis_task " +
                        "(profile_id, platform, status, task_key, job_key, job_row_id, request_json, " +
                        "lease_owner, lease_expires_at, created_at, updated_at) " +
                        "VALUES (1, 'boss', 'LEASED', 'profile-delete-active', 'boss-active', 10, '{}', " +
                        "'lease', '2099-01-01 00:00:00', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");

        ProfileEntity active = new ProfileEntity();
        active.setId(1L);
        active.setName("active");
        active.setIsActive(1);
        ProfileMapper profileMapper = mock(ProfileMapper.class);
        when(profileMapper.selectById(1L)).thenReturn(active);
        when(profileMapper.selectCount(isNull())).thenReturn(2L);
        when(profileMapper.selectOne(any(QueryWrapper.class))).thenReturn(active);
        ProfileService service = new ProfileService(
                profileMapper,
                jdbcTemplate,
                new DataSourceTransactionManager(dataSource)
        );

        ProfileService.DeleteProfileResult result = service.deleteProfile(1L, true);

        assertThat(result).isNotNull();
        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("AI 分析正在执行");
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM boss_data WHERE profile_id=1", Integer.class))
                .isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM job_analysis_task WHERE profile_id=1 AND status='LEASED'", Integer.class))
                .isEqualTo(1);
    }
}
