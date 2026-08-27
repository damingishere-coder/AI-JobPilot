package com.getjobs.application.service;

import com.getjobs.application.entity.Job51Entity;
import com.getjobs.application.entity.LiepinEntity;
import com.getjobs.application.mapper.Job51ConfigMapper;
import com.getjobs.application.mapper.Job51Mapper;
import com.getjobs.application.mapper.Job51OptionMapper;
import com.getjobs.application.mapper.LiepinConfigMapper;
import com.getjobs.application.mapper.LiepinMapper;
import com.getjobs.application.mapper.LiepinOptionMapper;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class LegacyPlatformBatchInsertTest {
    @TempDir
    Path tempDir;

    private HikariDataSource dataSource;

    @AfterEach
    void closeDataSource() {
        if (dataSource != null) dataSource.close();
    }

    @Test
    void job51DuplicateRowsInOneBatchDoNotRollbackTheWholeBatch() {
        JdbcTemplate jdbcTemplate = migratedDatabase("job51-batch.db");
        long profileId = insertProfile(jdbcTemplate);
        ProfileService profileService = profileService(profileId);
        Job51Mapper mapper = mock(Job51Mapper.class);
        when(mapper.selectList(any())).thenReturn(List.of());
        Job51Service service = new Job51Service(
                mock(Job51ConfigMapper.class), mock(Job51OptionMapper.class), mapper, dataSource, profileService);

        Job51Entity first = new Job51Entity();
        first.setJobId(51001L);
        Job51Entity duplicate = new Job51Entity();
        duplicate.setJobId(51001L);
        service.batchInsertIfNotExists(List.of(first, duplicate));

        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM job51_data WHERE profile_id=? AND job_id=?",
                Integer.class, profileId, 51001L)).isEqualTo(1);
    }

    @Test
    void liepinDuplicateRowsInOneBatchDoNotRollbackTheWholeBatch() {
        JdbcTemplate jdbcTemplate = migratedDatabase("liepin-batch.db");
        long profileId = insertProfile(jdbcTemplate);
        ProfileService profileService = profileService(profileId);
        LiepinMapper mapper = mock(LiepinMapper.class);
        when(mapper.selectList(any())).thenReturn(List.of());
        LiepinService service = new LiepinService(
                mock(LiepinConfigMapper.class), mock(LiepinOptionMapper.class), mapper, dataSource, profileService);

        LiepinEntity first = new LiepinEntity();
        first.setJobId(52001L);
        LiepinEntity duplicate = new LiepinEntity();
        duplicate.setJobId(52001L);
        service.insertSnapshotsIfNotExistsBatch(List.of(first, duplicate));

        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM liepin_data WHERE profile_id=? AND job_id=?",
                Integer.class, profileId, 52001L)).isEqualTo(1);
    }

    private JdbcTemplate migratedDatabase(String fileName) {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:sqlite:" + tempDir.resolve(fileName).toAbsolutePath());
        config.setConnectionInitSql("PRAGMA foreign_keys=ON");
        dataSource = new HikariDataSource(config);
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();
        return new JdbcTemplate(dataSource);
    }

    private long insertProfile(JdbcTemplate jdbcTemplate) {
        jdbcTemplate.update("INSERT INTO profile(name, is_active, created_at, updated_at) " +
                "VALUES ('batch-test', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
        return jdbcTemplate.queryForObject("SELECT id FROM profile WHERE name='batch-test'", Long.class);
    }

    private ProfileService profileService(long profileId) {
        ProfileService profileService = mock(ProfileService.class);
        when(profileService.getCurrentProfileId()).thenReturn(profileId);
        return profileService;
    }
}
