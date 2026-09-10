package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 * 为智联稳定岗位标识建立唯一事实源。历史重复数据必须人工处理，迁移不会自动删除或合并。
 */
public class V10__unique_zhilian_profile_job extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        List<String> duplicates = duplicateGroups(context);
        if (!duplicates.isEmpty()) {
            throw new IllegalStateException("智联岗位存在重复记录，拒绝自动清理: " + String.join("; ", duplicates));
        }
        try (Statement statement = context.getConnection().createStatement()) {
            statement.execute("""
                    CREATE UNIQUE INDEX idx_zhilian_data_profile_job_id
                    ON zhilian_data(profile_id, TRIM(job_id))
                    WHERE profile_id IS NOT NULL AND job_id IS NOT NULL AND TRIM(job_id) <> ''
                    """);
        }
    }

    private List<String> duplicateGroups(Context context) throws Exception {
        List<String> groups = new ArrayList<>();
        try (PreparedStatement duplicateQuery = context.getConnection().prepareStatement("""
                SELECT profile_id, TRIM(job_id) AS job_id
                  FROM zhilian_data
                 WHERE profile_id IS NOT NULL AND job_id IS NOT NULL AND TRIM(job_id) <> ''
                 GROUP BY profile_id, TRIM(job_id)
                HAVING COUNT(*) > 1
                 ORDER BY profile_id, TRIM(job_id)
                """);
             ResultSet duplicates = duplicateQuery.executeQuery()) {
            while (duplicates.next()) {
                long profileId = duplicates.getLong("profile_id");
                String jobId = duplicates.getString("job_id");
                groups.add("profile_id=" + profileId + ", job_id=" + jobId + ", ids="
                        + rowIds(context, profileId, jobId));
            }
        }
        return groups;
    }

    private List<Long> rowIds(Context context, long profileId, String jobId) throws Exception {
        List<Long> ids = new ArrayList<>();
        try (PreparedStatement statement = context.getConnection().prepareStatement(
                "SELECT id FROM zhilian_data WHERE profile_id=? AND TRIM(job_id)=? ORDER BY id")) {
            statement.setLong(1, profileId);
            statement.setString(2, jobId);
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) ids.add(resultSet.getLong("id"));
            }
        }
        return ids;
    }
}
