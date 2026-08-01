package com.getjobs.application.service;

import com.getjobs.application.config.RuntimeDirectoryInitializer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.sqlite.SQLiteDataSource;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class DatabaseSchemaServiceAiThresholdTest {
    @TempDir
    Path tempDir;

    @Test
    void addsThresholdColumnsToExistingAiTable() throws Exception {
        SQLiteDataSource dataSource = new SQLiteDataSource();
        dataSource.setUrl("jdbc:sqlite:" + tempDir.resolve("schema-test.db"));

        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute("""
                    CREATE TABLE ai (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        profile_id INTEGER,
                        introduce TEXT,
                        prompt TEXT
                    )
                    """);
        }

        DatabaseSchemaService service = new DatabaseSchemaService(
                dataSource,
                mock(RuntimeDirectoryInitializer.class)
        );
        service.initializeSchema();

        Set<String> columns = new HashSet<>();
        try (Connection connection = dataSource.getConnection();
             Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery("PRAGMA table_info(ai)")) {
            while (resultSet.next()) {
                columns.add(resultSet.getString("name"));
            }
        }

        assertThat(columns).contains("apply_threshold", "priority_apply_threshold");
    }
}
