package com.getjobs.application.service;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ApplicationReadinessServiceTest {
    @TempDir
    Path tempDir;

    @Test
    void reportsReadyWithoutCallingAProvider() {
        DriverManagerDataSource dataSource = migratedDataSource("ready.db");
        ChromeJobAnalysisQueueService queue = mock(ChromeJobAnalysisQueueService.class);
        when(queue.healthSnapshot()).thenReturn(
                new ChromeJobAnalysisQueueService.QueueHealth(true, false, 3, 1, 2, 198));

        ApplicationReadinessService.ReadinessReport report =
                new ApplicationReadinessService(dataSource, queue).check();

        assertThat(report.ready()).isTrue();
        assertThat(report.status()).isEqualTo("UP");
        assertThat(report.checks()).containsKeys("database", "analysisQueue");
    }

    @Test
    void failsClosedWhenSchemaIsIncomplete() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:sqlite:" + tempDir.resolve("broken.db").toAbsolutePath());
        ChromeJobAnalysisQueueService queue = mock(ChromeJobAnalysisQueueService.class);
        when(queue.healthSnapshot()).thenReturn(
                new ChromeJobAnalysisQueueService.QueueHealth(true, false, 0, 0, 0, 200));

        ApplicationReadinessService.ReadinessReport report =
                new ApplicationReadinessService(dataSource, queue).check();

        assertThat(report.ready()).isFalse();
        assertThat(report.status()).isEqualTo("DOWN");
    }

    @Test
    void failsClosedWhenQueueIsStopping() {
        DriverManagerDataSource dataSource = migratedDataSource("queue-stopping.db");
        ChromeJobAnalysisQueueService queue = mock(ChromeJobAnalysisQueueService.class);
        when(queue.healthSnapshot()).thenReturn(
                new ChromeJobAnalysisQueueService.QueueHealth(false, true, 0, 0, 0, 200));

        assertThat(new ApplicationReadinessService(dataSource, queue).check().ready()).isFalse();
    }

    private DriverManagerDataSource migratedDataSource(String name) {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:sqlite:" + tempDir.resolve(name).toAbsolutePath());
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();
        return dataSource;
    }
}
