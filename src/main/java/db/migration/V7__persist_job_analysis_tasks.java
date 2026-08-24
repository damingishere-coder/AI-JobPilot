package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.ResultSet;
import java.sql.Statement;

/**
 * 将 V4 的批次统计表演进为逐岗位的持久 AI 任务表；旧聚合行原样保留且不会被调度。
 */
public class V7__persist_job_analysis_tasks extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        try (Statement statement = context.getConnection().createStatement()) {
            addColumn(statement, "task_key", "TEXT");
            addColumn(statement, "job_key", "TEXT");
            addColumn(statement, "job_row_id", "INTEGER");
            addColumn(statement, "request_json", "TEXT");
            addColumn(statement, "attempt_count", "INTEGER NOT NULL DEFAULT 0");
            addColumn(statement, "next_retry_at", "DATETIME");
            addColumn(statement, "lease_owner", "TEXT");
            addColumn(statement, "lease_expires_at", "DATETIME");
            addColumn(statement, "last_error", "TEXT");
            addColumn(statement, "started_at", "DATETIME");
            addColumn(statement, "completed_at", "DATETIME");

            statement.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_job_analysis_task_task_key " +
                    "ON job_analysis_task(task_key) WHERE task_key IS NOT NULL");
            statement.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_job_analysis_task_active_job " +
                    "ON job_analysis_task(profile_id, platform, job_key) " +
                    "WHERE task_key IS NOT NULL AND status IN ('PENDING', 'LEASED')");
            statement.execute("CREATE INDEX IF NOT EXISTS idx_job_analysis_task_dispatch " +
                    "ON job_analysis_task(status, next_retry_at, id)");
            statement.execute("CREATE INDEX IF NOT EXISTS idx_job_analysis_task_lease " +
                    "ON job_analysis_task(status, lease_expires_at)");
        }
    }

    private void addColumn(Statement statement, String column, String definition) throws Exception {
        if (!columnExists(statement, column)) {
            statement.execute("ALTER TABLE job_analysis_task ADD COLUMN " + column + " " + definition);
        }
    }

    private boolean columnExists(Statement statement, String column) throws Exception {
        try (ResultSet resultSet = statement.executeQuery("PRAGMA table_info('job_analysis_task')")) {
            while (resultSet.next()) {
                if (column.equalsIgnoreCase(resultSet.getString("name"))) {
                    return true;
                }
            }
        }
        return false;
    }
}
