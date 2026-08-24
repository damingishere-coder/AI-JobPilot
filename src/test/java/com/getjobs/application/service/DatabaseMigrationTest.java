package com.getjobs.application.service;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DatabaseMigrationTest {
    @TempDir
    Path tempDir;

    @Test
    void freshDatabaseMigratesThroughV7AndMatchesSchemaContract() throws Exception {
        String url = sqliteUrl(tempDir.resolve("fresh.db"));

        Flyway flyway = flyway(url);
        flyway.migrate();

        try (Connection connection = DriverManager.getConnection(url)) {
            DatabaseSchemaService.validateSchema(connection);
            assertThat(scalar(connection,
                    "SELECT COUNT(*) FROM flyway_schema_history WHERE success=1 AND version='7'"))
                    .isEqualTo(1L);
            assertThat(columns(connection, "ai")).contains("apply_threshold", "priority_apply_threshold");
            assertThat(columns(connection, "boss_data"))
                    .contains("source_keyword", "salary_min_k", "salary_max_k", "salary_median_k", "salary_months");
            assertThat(columns(connection, "liepin_data")).contains("delivery_status");
            assertThat(columns(connection, "job51_data")).contains("delivery_status");
            assertThat(tableExists(connection, "delivery_attempt")).isTrue();
            assertThat(columns(connection, "job_analysis_task"))
                    .contains("task_key", "job_key", "job_row_id", "request_json", "attempt_count",
                            "lease_owner", "lease_expires_at", "last_error", "started_at", "completed_at");
        }
    }

    @Test
    void v7PreservesLegacyAggregateRowsAndLeavesThemUndispatchable() throws Exception {
        String url = sqliteUrl(tempDir.resolve("legacy-ai-task.db"));
        Flyway beforeV7 = Flyway.configure()
                .dataSource(url, null, null)
                .locations("classpath:db/migration")
                .target("6")
                .load();
        beforeV7.migrate();
        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
            statement.execute("INSERT INTO job_analysis_task(platform, scan_run_id, status, total_count, created_at) " +
                    "VALUES ('boss', 'legacy-run', 'SUCCEEDED', 12, CURRENT_TIMESTAMP)");
        }

        flyway(url).migrate();

        try (Connection connection = DriverManager.getConnection(url)) {
            assertThat(scalar(connection, "SELECT COUNT(*) FROM job_analysis_task WHERE scan_run_id='legacy-run'"))
                    .isEqualTo(1L);
            assertThat(scalar(connection, "SELECT COUNT(*) FROM job_analysis_task WHERE task_key IS NOT NULL"))
                    .isZero();
            assertThat(columns(connection, "job_analysis_task"))
                    .contains("task_key", "request_json", "lease_expires_at");
        }
    }

    @Test
    void v6ImportsLegacyDeliveryFactsWithoutInventingNewConfirmations() throws Exception {
        String url = sqliteUrl(tempDir.resolve("legacy-delivery.db"));
        Flyway flyway = Flyway.configure()
                .dataSource(url, null, null)
                .locations("classpath:db/migration")
                .target("5")
                .load();
        flyway.migrate();
        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
            statement.execute("INSERT INTO profile(id, name, is_active) VALUES (1, 'profile', 1)");
            statement.execute("INSERT INTO boss_data(id, profile_id, encrypt_id, delivery_status, created_at) " +
                    "VALUES (10, 1, 'boss-key', '已投递', CURRENT_TIMESTAMP)");
            statement.execute("INSERT INTO zhilian_data(id, profile_id, job_id, delivery_status, create_time) " +
                    "VALUES (20, 1, 'zhilian-key', '投递失败', CURRENT_TIMESTAMP)");
            statement.execute("INSERT INTO liepin_data(job_id, delivered, create_time) VALUES (30, 1, CURRENT_TIMESTAMP)");
            statement.execute("INSERT INTO job51_data(job_id, delivered, create_time) VALUES (40, 0, CURRENT_TIMESTAMP)");
        }

        flyway(url).migrate();

        try (Connection connection = DriverManager.getConnection(url)) {
            assertThat(scalar(connection, "SELECT COUNT(*) FROM delivery_attempt WHERE state='CONFIRMED'"))
                    .isEqualTo(2L);
            assertThat(scalar(connection, "SELECT COUNT(*) FROM delivery_attempt WHERE state='FAILED'"))
                    .isEqualTo(1L);
            assertThat(scalar(connection, "SELECT COUNT(*) FROM delivery_attempt WHERE platform='51job'"))
                    .isZero();
            assertThat(scalar(connection, "SELECT COUNT(*) FROM liepin_data WHERE delivery_status='已投递'"))
                    .isEqualTo(1L);
            assertThat(scalar(connection, "SELECT COUNT(*) FROM job51_data WHERE delivery_status='未投递'"))
                    .isEqualTo(1L);
        }
    }

    @Test
    void nonEmptyLegacyDatabaseIsBaselinedThenSafelyCompletedByV5() throws Exception {
        String url = sqliteUrl(tempDir.resolve("legacy.db"));
        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE profile (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)");
            statement.execute("INSERT INTO profile(name) VALUES ('legacy-profile')");
            statement.execute("CREATE TABLE priority_company (" +
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL UNIQUE)");
            statement.execute("INSERT INTO priority_company(company_name) VALUES ('legacy-company')");
        }

        flyway(url).migrate();

        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
            DatabaseSchemaService.validateSchema(connection);
            assertThat(scalar(connection, "SELECT COUNT(*) FROM priority_company")).isEqualTo(1L);
            assertThat(scalar(connection,
                    "SELECT COUNT(*) FROM flyway_schema_history WHERE type='BASELINE' AND version='4'"))
                    .isEqualTo(1L);
            assertThat(scalar(connection,
                    "SELECT COUNT(*) FROM flyway_schema_history WHERE success=1 AND version='5'"))
                    .isEqualTo(1L);

            statement.execute("INSERT INTO profile(name, is_active) VALUES ('second-profile', 0)");
            long secondProfileId = scalar(connection, "SELECT MAX(id) FROM profile");
            statement.execute("INSERT INTO priority_company(profile_id, company_name) VALUES (" +
                    secondProfileId + ", 'legacy-company')");
            assertThat(scalar(connection,
                    "SELECT COUNT(*) FROM priority_company WHERE company_name='legacy-company'"))
                    .isEqualTo(2L);
        }
    }

    @Test
    void legacyStandaloneCompanyUniqueIndexIsDetectedAndRebuilt() throws Exception {
        String url = sqliteUrl(tempDir.resolve("legacy-index.db"));
        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE profile (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)");
            statement.execute("INSERT INTO profile(name) VALUES ('legacy-profile')");
            statement.execute("CREATE TABLE priority_company (" +
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER, company_name TEXT NOT NULL)");
            statement.execute("CREATE UNIQUE INDEX legacy_company_name_unique ON priority_company(company_name)");
            statement.execute("INSERT INTO priority_company(profile_id, company_name) VALUES (1, 'legacy-company')");
        }

        flyway(url).migrate();

        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
            DatabaseSchemaService.validateSchema(connection);
            statement.execute("INSERT INTO profile(name, is_active) VALUES ('second-profile', 0)");
            long secondProfileId = scalar(connection, "SELECT MAX(id) FROM profile");
            statement.execute("INSERT INTO priority_company(profile_id, company_name) VALUES (" +
                    secondProfileId + ", 'legacy-company')");
            assertThat(scalar(connection,
                    "SELECT COUNT(*) FROM priority_company WHERE company_name='legacy-company'"))
                    .isEqualTo(2L);
        }
    }

    @Test
    void failedLegacyMigrationRollsBackSchemaAndPreservesRows() throws Exception {
        String url = sqliteUrl(tempDir.resolve("legacy-duplicate.db"));
        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE profile (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)");
            statement.execute("INSERT INTO profile(name) VALUES ('legacy-profile')");
            statement.execute("CREATE TABLE priority_company (" +
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER, company_name TEXT NOT NULL)");
            statement.execute("INSERT INTO priority_company(profile_id, company_name) VALUES (1, 'duplicate-company')");
            statement.execute("INSERT INTO priority_company(profile_id, company_name) VALUES (1, 'duplicate-company')");
        }

        assertThatThrownBy(() -> flyway(url).migrate())
                .hasMessageContaining("Migration failed")
                .hasStackTraceContaining(
                        "UNIQUE constraint failed: priority_company.profile_id, priority_company.company_name");

        try (Connection connection = DriverManager.getConnection(url)) {
            assertThat(scalar(connection, "SELECT COUNT(*) FROM priority_company")).isEqualTo(2L);
            assertThat(columns(connection, "profile")).doesNotContain("is_active");
            assertThat(tableExists(connection, "boss_data")).isFalse();
            assertThat(tableExists(connection, "priority_company_profile_new")).isFalse();
            assertThat(scalar(connection,
                    "SELECT COUNT(*) FROM flyway_schema_history WHERE success=1 AND version='5'"))
                    .isZero();
        }
    }

    @Test
    void schemaValidationFailsWhenCriticalObjectIsMissing() throws Exception {
        String url = sqliteUrl(tempDir.resolve("broken.db"));
        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE profile (id INTEGER PRIMARY KEY, is_active INTEGER)");

            org.assertj.core.api.Assertions.assertThatThrownBy(() -> DatabaseSchemaService.validateSchema(connection))
                    .isInstanceOf(java.sql.SQLException.class)
                    .hasMessageContaining("缺少必要数据表");
        }
    }

    private Flyway flyway(String url) {
        return Flyway.configure()
                .dataSource(url, null, null)
                .locations("classpath:db/migration")
                .baselineOnMigrate(true)
                .baselineVersion("4")
                .validateOnMigrate(true)
                .load();
    }

    private String sqliteUrl(Path path) {
        return "jdbc:sqlite:" + path.toAbsolutePath();
    }

    private long scalar(Connection connection, String sql) throws Exception {
        try (Statement statement = connection.createStatement(); ResultSet resultSet = statement.executeQuery(sql)) {
            return resultSet.next() ? resultSet.getLong(1) : 0L;
        }
    }

    private java.util.Set<String> columns(Connection connection, String table) throws Exception {
        java.util.Set<String> columns = new java.util.HashSet<>();
        try (Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery("PRAGMA table_info('" + table + "')")) {
            while (resultSet.next()) {
                columns.add(resultSet.getString("name"));
            }
        }
        return columns;
    }

    private boolean tableExists(Connection connection, String table) throws Exception {
        try (Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery(
                     "SELECT 1 FROM sqlite_master WHERE type='table' AND name='" + table + "'")) {
            return resultSet.next();
        }
    }
}
