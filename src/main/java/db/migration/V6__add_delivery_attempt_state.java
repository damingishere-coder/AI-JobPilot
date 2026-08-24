package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.ResultSet;
import java.sql.Statement;

/**
 * 增加可审计、可幂等的投递 attempt；旧状态字段继续作为兼容读模型。
 */
public class V6__add_delivery_attempt_state extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        try (Statement statement = context.getConnection().createStatement()) {
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS delivery_attempt (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        request_key TEXT NOT NULL UNIQUE CHECK (TRIM(request_key) <> ''),
                        platform TEXT NOT NULL CHECK (platform IN ('boss', 'zhilian', 'liepin', '51job')),
                        profile_id INTEGER,
                        job_key TEXT NOT NULL,
                        job_row_id INTEGER NOT NULL CHECK (job_row_id > 0),
                        state TEXT NOT NULL CHECK (state IN ('REQUESTED', 'CONFIRMED', 'FAILED', 'UNKNOWN')),
                        evidence TEXT,
                        message TEXT,
                        failure_type TEXT,
                        failure_reason TEXT,
                        requested_at DATETIME NOT NULL,
                        resolved_at DATETIME,
                        updated_at DATETIME NOT NULL
                    )
                    """);
            statement.execute("CREATE INDEX IF NOT EXISTS idx_delivery_attempt_job " +
                    "ON delivery_attempt(platform, profile_id, job_row_id, id)");
            statement.execute("CREATE INDEX IF NOT EXISTS idx_delivery_attempt_state_updated " +
                    "ON delivery_attempt(state, updated_at)");

            boolean liepinStatusAdded = addColumn(statement, "liepin_data", "delivery_status", "TEXT DEFAULT '未投递'");
            boolean job51StatusAdded = addColumn(statement, "job51_data", "delivery_status", "TEXT DEFAULT '未投递'");
            backfillBinaryStatus(statement, "liepin_data", liepinStatusAdded);
            backfillBinaryStatus(statement, "job51_data", job51StatusAdded);

            importLegacyBoss(statement);
            importLegacyZhilian(statement);
            importLegacyBinaryPlatform(statement, "liepin", "liepin_data");
            importLegacyBinaryPlatform(statement, "51job", "job51_data");
        }
    }

    private void importLegacyBoss(Statement statement) throws Exception {
        statement.executeUpdate("""
                INSERT OR IGNORE INTO delivery_attempt (
                    request_key, platform, profile_id, job_key, job_row_id, state,
                    evidence, message, requested_at, resolved_at, updated_at
                )
                SELECT 'legacy:boss:' || id, 'boss', profile_id,
                       COALESCE(NULLIF(encrypt_id, ''), CAST(id AS TEXT)), id,
                       CASE WHEN TRIM(delivery_status) = '已投递' THEN 'CONFIRMED' ELSE 'FAILED' END,
                       'LEGACY_STATUS_IMPORT', '由 V6 导入旧投递状态',
                       COALESCE(NULLIF(TRIM(updated_at), ''), NULLIF(TRIM(created_at), ''), CURRENT_TIMESTAMP),
                       COALESCE(NULLIF(TRIM(updated_at), ''), NULLIF(TRIM(created_at), ''), CURRENT_TIMESTAMP),
                       COALESCE(NULLIF(TRIM(updated_at), ''), NULLIF(TRIM(created_at), ''), CURRENT_TIMESTAMP)
                  FROM boss_data
                 WHERE TRIM(COALESCE(delivery_status, '')) IN ('已投递', '投递失败')
                """);
    }

    private void importLegacyZhilian(Statement statement) throws Exception {
        statement.executeUpdate("""
                INSERT OR IGNORE INTO delivery_attempt (
                    request_key, platform, profile_id, job_key, job_row_id, state,
                    evidence, message, requested_at, resolved_at, updated_at
                )
                SELECT 'legacy:zhilian:' || id, 'zhilian', profile_id,
                       COALESCE(NULLIF(job_id, ''), CAST(id AS TEXT)), id,
                       CASE WHEN TRIM(delivery_status) = '已投递' THEN 'CONFIRMED' ELSE 'FAILED' END,
                       'LEGACY_STATUS_IMPORT', '由 V6 导入旧投递状态',
                       COALESCE(NULLIF(TRIM(update_time), ''), NULLIF(TRIM(create_time), ''), CURRENT_TIMESTAMP),
                       COALESCE(NULLIF(TRIM(update_time), ''), NULLIF(TRIM(create_time), ''), CURRENT_TIMESTAMP),
                       COALESCE(NULLIF(TRIM(update_time), ''), NULLIF(TRIM(create_time), ''), CURRENT_TIMESTAMP)
                  FROM zhilian_data
                 WHERE TRIM(COALESCE(delivery_status, '')) IN ('已投递', '投递失败')
                """);
    }

    private void importLegacyBinaryPlatform(Statement statement, String platform, String table) throws Exception {
        statement.executeUpdate("INSERT OR IGNORE INTO delivery_attempt (" +
                "request_key, platform, profile_id, job_key, job_row_id, state, " +
                "evidence, message, requested_at, resolved_at, updated_at) " +
                "SELECT 'legacy:" + platform + ":' || job_id, '" + platform + "', NULL, " +
                "CAST(job_id AS TEXT), job_id, 'CONFIRMED', 'LEGACY_STATUS_IMPORT', " +
                "'由 V6 导入旧投递状态', COALESCE(NULLIF(TRIM(update_time), ''), NULLIF(TRIM(create_time), ''), CURRENT_TIMESTAMP), " +
                "COALESCE(NULLIF(TRIM(update_time), ''), NULLIF(TRIM(create_time), ''), CURRENT_TIMESTAMP), " +
                "COALESCE(NULLIF(TRIM(update_time), ''), NULLIF(TRIM(create_time), ''), CURRENT_TIMESTAMP) " +
                "FROM " + table + " WHERE delivered = 1");
    }

    private void backfillBinaryStatus(Statement statement, String table, boolean columnAdded) throws Exception {
        String predicate = columnAdded ? "1=1" : "delivery_status IS NULL OR TRIM(delivery_status) = ''";
        statement.executeUpdate("UPDATE " + table + " SET delivery_status = " +
                "CASE WHEN delivered = 1 THEN '已投递' ELSE '未投递' END WHERE " + predicate);
    }

    private boolean addColumn(Statement statement, String table, String column, String definition) throws Exception {
        if (!columnExists(statement, table, column)) {
            statement.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
            return true;
        }
        return false;
    }

    private boolean columnExists(Statement statement, String table, String column) throws Exception {
        try (ResultSet resultSet = statement.executeQuery("PRAGMA table_info('" + table + "')")) {
            while (resultSet.next()) {
                if (column.equalsIgnoreCase(resultSet.getString("name"))) {
                    return true;
                }
            }
        }
        return false;
    }
}
