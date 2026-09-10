package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

/**
 * 将猎聘与 51job 的全局配置/岗位数据收敛到 Profile 边界。
 *
 * <p>历史表无法表达所属档案。只有数据库中恰好存在一个 Profile 时，旧数据的归属才
 * 是唯一的；否则迁移会失败关闭，避免把岗位或投递记录静默归到错误档案。</p>
 */
public class V8__scope_liepin_job51_by_profile extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        try (Statement statement = connection.createStatement()) {
            long profileCount = scalar(statement, "SELECT COUNT(*) FROM profile");
            long legacyRows = scalar(statement, "SELECT " +
                    "(SELECT COUNT(*) FROM liepin_config) + " +
                    "(SELECT COUNT(*) FROM liepin_data) + " +
                    "(SELECT COUNT(*) FROM job51_config) + " +
                    "(SELECT COUNT(*) FROM job51_data)");
            if (legacyRows > 0 && profileCount != 1) {
                throw new IllegalStateException(
                        "猎聘/51job 历史数据无法唯一归属 Profile：profile=" + profileCount +
                                "，legacyRows=" + legacyRows + "；请先备份并明确历史数据归属");
            }

            long profileId = profileCount == 1
                    ? scalar(statement, "SELECT id FROM profile LIMIT 1")
                    : -1L;
            assertAtMostOneConfig(statement, "liepin_config");
            assertAtMostOneConfig(statement, "job51_config");

            rebuildLiepinConfig(statement, profileId);
            rebuildJob51Config(statement, profileId);
            rebuildLiepinData(statement, profileId);
            rebuildJob51Data(statement, profileId);
            remapLegacyAttempts(statement, "liepin", "liepin_data", profileId);
            remapLegacyAttempts(statement, "51job", "job51_data", profileId);
            createIndexes(statement);
        }
    }

    private void assertAtMostOneConfig(Statement statement, String table) throws Exception {
        long count = scalar(statement, "SELECT COUNT(*) FROM " + table);
        if (count > 1) {
            throw new IllegalStateException(table + " 存在 " + count + " 条全局配置，无法无损判断应保留哪一条");
        }
    }

    private void rebuildLiepinConfig(Statement statement, long profileId) throws Exception {
        statement.execute("ALTER TABLE liepin_config RENAME TO liepin_config_v8_legacy");
        statement.execute("""
                CREATE TABLE liepin_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_id INTEGER NOT NULL,
                    keywords VARCHAR(500),
                    city VARCHAR(100),
                    salary_code VARCHAR(50),
                    created_at DATETIME,
                    updated_at DATETIME,
                    CONSTRAINT fk_liepin_config_profile FOREIGN KEY(profile_id) REFERENCES profile(id) ON DELETE RESTRICT,
                    CONSTRAINT uq_liepin_config_profile UNIQUE(profile_id)
                )
                """);
        if (profileId > 0) {
            statement.executeUpdate("INSERT INTO liepin_config " +
                    "(id, profile_id, keywords, city, salary_code, created_at, updated_at) " +
                    "SELECT id, " + profileId + ", keywords, city, salary_code, created_at, updated_at " +
                    "FROM liepin_config_v8_legacy");
        }
        statement.execute("DROP TABLE liepin_config_v8_legacy");
    }

    private void rebuildJob51Config(Statement statement, long profileId) throws Exception {
        statement.execute("ALTER TABLE job51_config RENAME TO job51_config_v8_legacy");
        statement.execute("""
                CREATE TABLE job51_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_id INTEGER NOT NULL,
                    keywords VARCHAR(500),
                    job_area VARCHAR(100),
                    salary VARCHAR(50),
                    created_at DATETIME,
                    updated_at DATETIME,
                    CONSTRAINT fk_job51_config_profile FOREIGN KEY(profile_id) REFERENCES profile(id) ON DELETE RESTRICT,
                    CONSTRAINT uq_job51_config_profile UNIQUE(profile_id)
                )
                """);
        if (profileId > 0) {
            statement.executeUpdate("INSERT INTO job51_config " +
                    "(id, profile_id, keywords, job_area, salary, created_at, updated_at) " +
                    "SELECT id, " + profileId + ", keywords, job_area, salary, created_at, updated_at " +
                    "FROM job51_config_v8_legacy");
        }
        statement.execute("DROP TABLE job51_config_v8_legacy");
    }

    private void rebuildLiepinData(Statement statement, long profileId) throws Exception {
        statement.execute("ALTER TABLE liepin_data RENAME TO liepin_data_v8_legacy");
        statement.execute("""
                CREATE TABLE liepin_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_id INTEGER NOT NULL,
                    job_id BIGINT NOT NULL,
                    job_title VARCHAR(200),
                    job_link VARCHAR(300),
                    job_salary_text VARCHAR(100),
                    job_area VARCHAR(100),
                    job_edu_req VARCHAR(50),
                    job_exp_req VARCHAR(50),
                    job_publish_time VARCHAR(50),
                    comp_id BIGINT,
                    comp_name VARCHAR(200),
                    comp_industry VARCHAR(100),
                    comp_scale VARCHAR(50),
                    hr_id VARCHAR(64),
                    hr_name VARCHAR(50),
                    hr_title VARCHAR(100),
                    hr_im_id VARCHAR(64),
                    delivered INTEGER NOT NULL DEFAULT 0,
                    delivery_status TEXT NOT NULL DEFAULT '未投递',
                    create_time DATETIME,
                    update_time DATETIME,
                    CONSTRAINT fk_liepin_data_profile FOREIGN KEY(profile_id) REFERENCES profile(id) ON DELETE RESTRICT,
                    CONSTRAINT uq_liepin_data_profile_job UNIQUE(profile_id, job_id)
                )
                """);
        if (profileId > 0) {
            statement.executeUpdate("INSERT INTO liepin_data " +
                    "(profile_id, job_id, job_title, job_link, job_salary_text, job_area, job_edu_req, job_exp_req, " +
                    "job_publish_time, comp_id, comp_name, comp_industry, comp_scale, hr_id, hr_name, hr_title, " +
                    "hr_im_id, delivered, delivery_status, create_time, update_time) " +
                    "SELECT " + profileId + ", job_id, job_title, job_link, job_salary_text, job_area, job_edu_req, " +
                    "job_exp_req, job_publish_time, comp_id, comp_name, comp_industry, comp_scale, hr_id, hr_name, " +
                    "hr_title, hr_im_id, COALESCE(delivered, 0), " +
                    "COALESCE(NULLIF(TRIM(delivery_status), ''), CASE WHEN delivered=1 THEN '已投递' ELSE '未投递' END), " +
                    "create_time, update_time FROM liepin_data_v8_legacy");
        }
        statement.execute("DROP TABLE liepin_data_v8_legacy");
    }

    private void rebuildJob51Data(Statement statement, long profileId) throws Exception {
        statement.execute("ALTER TABLE job51_data RENAME TO job51_data_v8_legacy");
        statement.execute("""
                CREATE TABLE job51_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_id INTEGER NOT NULL,
                    job_id BIGINT NOT NULL,
                    job_title VARCHAR(200),
                    job_link VARCHAR(300),
                    job_salary_text VARCHAR(100),
                    job_area VARCHAR(100),
                    job_edu_req VARCHAR(50),
                    job_exp_req VARCHAR(50),
                    job_publish_time VARCHAR(50),
                    comp_id BIGINT,
                    comp_name VARCHAR(200),
                    comp_industry VARCHAR(100),
                    comp_scale VARCHAR(50),
                    hr_id VARCHAR(64),
                    hr_name VARCHAR(50),
                    hr_title VARCHAR(100),
                    delivered INTEGER NOT NULL DEFAULT 0,
                    delivery_status TEXT NOT NULL DEFAULT '未投递',
                    create_time TEXT,
                    update_time TEXT,
                    CONSTRAINT fk_job51_data_profile FOREIGN KEY(profile_id) REFERENCES profile(id) ON DELETE RESTRICT,
                    CONSTRAINT uq_job51_data_profile_job UNIQUE(profile_id, job_id)
                )
                """);
        if (profileId > 0) {
            statement.executeUpdate("INSERT INTO job51_data " +
                    "(profile_id, job_id, job_title, job_link, job_salary_text, job_area, job_edu_req, job_exp_req, " +
                    "job_publish_time, comp_id, comp_name, comp_industry, comp_scale, hr_id, hr_name, hr_title, " +
                    "delivered, delivery_status, create_time, update_time) " +
                    "SELECT " + profileId + ", job_id, job_title, job_link, job_salary_text, job_area, job_edu_req, " +
                    "job_exp_req, job_publish_time, comp_id, comp_name, comp_industry, comp_scale, hr_id, hr_name, " +
                    "hr_title, COALESCE(delivered, 0), " +
                    "COALESCE(NULLIF(TRIM(delivery_status), ''), CASE WHEN delivered=1 THEN '已投递' ELSE '未投递' END), " +
                    "create_time, update_time FROM job51_data_v8_legacy");
        }
        statement.execute("DROP TABLE job51_data_v8_legacy");
    }

    private void remapLegacyAttempts(Statement statement,
                                     String platform,
                                     String table,
                                     long profileId) throws Exception {
        long attempts = scalar(statement, "SELECT COUNT(*) FROM delivery_attempt " +
                "WHERE platform='" + platform + "' AND profile_id IS NULL");
        if (attempts == 0) {
            return;
        }
        if (profileId <= 0) {
            throw new IllegalStateException(platform + " 存在无法归属 Profile 的历史投递记录");
        }
        statement.executeUpdate("UPDATE delivery_attempt SET profile_id=" + profileId + ", " +
                "job_row_id=(SELECT id FROM " + table + " d WHERE d.profile_id=" + profileId +
                " AND CAST(d.job_id AS TEXT)=delivery_attempt.job_key) " +
                "WHERE platform='" + platform + "' AND profile_id IS NULL " +
                "AND EXISTS (SELECT 1 FROM " + table + " d WHERE d.profile_id=" + profileId +
                " AND CAST(d.job_id AS TEXT)=delivery_attempt.job_key)");
        long unresolved = scalar(statement, "SELECT COUNT(*) FROM delivery_attempt " +
                "WHERE platform='" + platform + "' AND profile_id IS NULL");
        if (unresolved > 0) {
            throw new IllegalStateException(platform + " 有 " + unresolved + " 条历史投递记录无法唯一映射到岗位");
        }
    }

    private void createIndexes(Statement statement) throws Exception {
        statement.execute("CREATE INDEX idx_liepin_data_company_job ON liepin_data(comp_name, job_title)");
        statement.execute("CREATE INDEX idx_job51_data_company_job ON job51_data(comp_name, job_title)");
        statement.execute("CREATE INDEX idx_liepin_data_profile_company_job ON liepin_data(profile_id, comp_name, job_title)");
        statement.execute("CREATE INDEX idx_job51_data_profile_company_job ON job51_data(profile_id, comp_name, job_title)");
        statement.execute("CREATE INDEX idx_liepin_data_profile_status ON liepin_data(profile_id, delivery_status)");
        statement.execute("CREATE INDEX idx_job51_data_profile_status ON job51_data(profile_id, delivery_status)");
        statement.execute("CREATE INDEX IF NOT EXISTS idx_delivery_attempt_profile_state " +
                "ON delivery_attempt(profile_id, platform, state, updated_at)");
    }

    private long scalar(Statement statement, String sql) throws Exception {
        try (ResultSet resultSet = statement.executeQuery(sql)) {
            if (!resultSet.next()) {
                throw new IllegalStateException("查询未返回结果: " + sql);
            }
            return resultSet.getLong(1);
        }
    }
}
