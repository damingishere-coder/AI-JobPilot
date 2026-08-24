package com.getjobs.application.service;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class DatabaseMigrationRehearsalTest {
    private static final List<String> COUNTED_TABLES = List.of(
            "profile", "config", "cookie", "ai", "resume_profile", "priority_company",
            "job_ai_analysis", "job_analysis_task", "boss_data", "zhilian_data", "liepin_data", "job51_data"
    );

    @TempDir
    Path tempDir;

    @Test
    void migratesIsolatedCopyWithoutChangingSourceDatabase() throws Exception {
        String configuredPath = System.getenv("P0_REHEARSAL_DB");
        Assumptions.assumeTrue(configuredPath != null && !configuredPath.isBlank(),
                "设置 P0_REHEARSAL_DB 后才执行真实数据库副本演练");

        Path source = Path.of(configuredPath).toAbsolutePath().normalize();
        assertThat(source).isRegularFile();
        assertNoActiveSidecar(source);
        byte[] sourceHashBefore = sha256(source);
        FileTime sourceMtimeBefore = Files.getLastModifiedTime(source);

        Path rehearsal = tempDir.resolve("rehearsal.db");
        Files.copy(source, rehearsal);
        String rehearsalUrl = "jdbc:sqlite:" + rehearsal;
        Map<String, Long> countsBefore = tableCounts(rehearsalUrl);

        Flyway.configure()
                .dataSource(rehearsalUrl, null, null)
                .locations("classpath:db/migration")
                .baselineOnMigrate(true)
                .baselineVersion("4")
                .validateOnMigrate(true)
                .load()
                .migrate();

        try (Connection connection = DriverManager.getConnection(rehearsalUrl)) {
            DatabaseSchemaService.validateSchema(connection);
            assertThat(scalarText(connection, "PRAGMA integrity_check")).isEqualTo("ok");
            assertThat(scalarLong(connection,
                    "SELECT COUNT(*) FROM flyway_schema_history WHERE success=1 AND version='6'"))
                    .isEqualTo(1L);
            assertThat(scalarLong(connection,
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='delivery_attempt'"))
                    .isEqualTo(1L);
        }
        assertThat(tableCounts(rehearsalUrl)).containsAllEntriesOf(countsBefore);
        assertThat(sha256(source)).isEqualTo(sourceHashBefore);
        assertThat(Files.getLastModifiedTime(source)).isEqualTo(sourceMtimeBefore);
    }

    private void assertNoActiveSidecar(Path source) {
        for (String suffix : List.of("-wal", "-shm", "-journal")) {
            Path sidecar = Path.of(source.toString() + suffix);
            assertThat(sidecar)
                    .as("检测到 SQLite 活跃或未收敛侧车文件，拒绝复制: %s", sidecar)
                    .doesNotExist();
        }
    }

    private Map<String, Long> tableCounts(String url) throws Exception {
        Map<String, Long> counts = new LinkedHashMap<>();
        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
            for (String table : COUNTED_TABLES) {
                try (ResultSet resultSet = statement.executeQuery("SELECT COUNT(*) FROM " + table)) {
                    counts.put(table, resultSet.next() ? resultSet.getLong(1) : 0L);
                }
            }
        }
        return counts;
    }

    private long scalarLong(Connection connection, String sql) throws Exception {
        try (Statement statement = connection.createStatement(); ResultSet resultSet = statement.executeQuery(sql)) {
            return resultSet.next() ? resultSet.getLong(1) : 0L;
        }
    }

    private String scalarText(Connection connection, String sql) throws Exception {
        try (Statement statement = connection.createStatement(); ResultSet resultSet = statement.executeQuery(sql)) {
            return resultSet.next() ? resultSet.getString(1) : null;
        }
    }

    private byte[] sha256(Path path) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (var input = Files.newInputStream(path)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        return digest.digest();
    }
}
