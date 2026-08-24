package com.getjobs.application.service;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import com.getjobs.application.config.RuntimeDirectoryInitializer;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
@DependsOn("flywayInitializer")
public class DatabaseSchemaService {
    private final DataSource dataSource;
    private final RuntimeDirectoryInitializer runtimeDirectoryInitializer;

    @PostConstruct
    public void initializeSchema() {
        runtimeDirectoryInitializer.ensureRuntimeDirectories();
        try (Connection conn = dataSource.getConnection()) {
            validateSchema(conn);
            log.info("数据库 schema 校验完成");
        } catch (Exception e) {
            throw new IllegalStateException("数据库 schema 不完整，已阻止应用继续启动: " + e.getMessage(), e);
        }
    }

    /**
     * 只供 Flyway V5 调用的一次性旧库兼容迁移。运行期不得调用。
     */
    public static void migrateLegacySchema(Connection conn) throws Exception {
        try (Statement stmt = conn.createStatement()) {
            ensureCoreTables(stmt);
            ensureProfileColumns(stmt);
            ensureAiColumns(stmt);
            ensurePlatformConfigColumns(stmt);
            ensurePlatformDataColumns(stmt);
            addColumn(stmt, "liepin_data", "delivered", "INTEGER DEFAULT 0");
            addColumn(stmt, "job51_data", "delivered", "INTEGER DEFAULT 0");
            backfillProfileIds(stmt);
            ensurePriorityCompanySchema(stmt);
            backfillProfileIds(stmt);
            normalizeActiveProfile(stmt);
            ensureIndexes(stmt);
        }
    }

    private static void ensureCoreTables(Statement stmt) throws Exception {
        createTableIfNotExists(stmt, "profile",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "name TEXT NOT NULL, " +
                        "is_active INTEGER DEFAULT 0, " +
                        "created_at DATETIME, " +
                        "updated_at DATETIME");

        createTableIfNotExists(stmt, "config",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "config_key TEXT, " +
                        "config_value TEXT, " +
                        "config_type TEXT, " +
                        "category TEXT, " +
                        "description TEXT, " +
                        "created_at DATETIME, " +
                        "updated_at DATETIME");

        createTableIfNotExists(stmt, "cookie",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "platform TEXT, " +
                        "cookie_value TEXT, " +
                        "remark TEXT, " +
                        "created_at DATETIME, " +
                        "updated_at DATETIME");

        createTableIfNotExists(stmt, "ai",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "profile_id INTEGER, " +
                        "introduce TEXT, " +
                        "prompt TEXT, " +
                        "apply_threshold INTEGER DEFAULT 75, " +
                        "priority_apply_threshold INTEGER DEFAULT 65, " +
                        "created_at DATETIME, " +
                        "updated_at DATETIME");

        createTableIfNotExists(stmt, "resume_profile",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "profile_id INTEGER, " +
                        "resume_text TEXT, " +
                        "source_filename TEXT, " +
                        "parse_status TEXT, " +
                        "parse_message TEXT, " +
                        "created_at DATETIME, " +
                        "updated_at DATETIME");

        createTableIfNotExists(stmt, "job_ai_analysis",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "profile_id INTEGER, " +
                        "platform TEXT, " +
                        "job_key TEXT, " +
                        "company_name TEXT, " +
                        "job_name TEXT, " +
                        "scan_run_id TEXT, " +
                        "score INTEGER, " +
                        "decision TEXT, " +
                        "summary TEXT, " +
                        "strengths TEXT, " +
                        "risks TEXT, " +
                        "greeting TEXT, " +
                        "priority_company INTEGER DEFAULT 0, " +
                        "raw_response TEXT, " +
                        "created_at DATETIME, " +
                        "updated_at DATETIME");

        createTableIfNotExists(stmt, "boss_config",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "profile_id INTEGER, " +
                        "debugger INTEGER DEFAULT 0, " +
                        "wait_time INTEGER DEFAULT 10, " +
                        "keywords VARCHAR(500), " +
                        "city_code VARCHAR(200), " +
                        "industry VARCHAR(200), " +
                        "job_type VARCHAR(50), " +
                        "experience VARCHAR(50), " +
                        "degree VARCHAR(200), " +
                        "salary VARCHAR(50), " +
                        "scale VARCHAR(200), " +
                        "stage VARCHAR(200), " +
                        "say_hi TEXT, " +
                        "expected_salary_min INTEGER, " +
                        "expected_salary_max INTEGER, " +
                        "enable_ai INTEGER DEFAULT 1, " +
                        "send_img_resume INTEGER DEFAULT 0, " +
                        "filter_dead_hr INTEGER DEFAULT 1, " +
                        "auto_deliver INTEGER DEFAULT 0, " +
                        "search_job_limit INTEGER DEFAULT 20, " +
                        "dead_status VARCHAR(200), " +
                        "created_at DATETIME, " +
                        "updated_at DATETIME");

        createTableIfNotExists(stmt, "boss_data",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "profile_id INTEGER, " +
                        "encrypt_id TEXT, " +
                        "encrypt_user_id TEXT, " +
                        "company_name TEXT, " +
                        "job_name TEXT, " +
                        "salary TEXT, " +
                        "salary_min_k REAL, " +
                        "salary_max_k REAL, " +
                        "salary_median_k REAL, " +
                        "salary_months INTEGER, " +
                        "location TEXT, " +
                        "experience TEXT, " +
                        "degree TEXT, " +
                        "hr_name TEXT, " +
                        "hr_position TEXT, " +
                        "hr_active_status TEXT, " +
                        "delivery_status TEXT, " +
                        "failure_type TEXT, " +
                        "failure_reason TEXT, " +
                        "job_description TEXT, " +
                        "job_url TEXT, " +
                        "recruitment_status TEXT, " +
                        "company_address TEXT, " +
                        "industry TEXT, " +
                        "introduce TEXT, " +
                        "financing_stage TEXT, " +
                        "company_scale TEXT, " +
                        "source_keyword TEXT, " +
                        "scan_run_id TEXT, " +
                        "ai_score INTEGER, " +
                        "ai_decision TEXT, " +
                        "ai_reason TEXT, " +
                        "priority_company INTEGER DEFAULT 0, " +
                        "created_at TEXT, " +
                        "updated_at TEXT");

        createTableIfNotExists(stmt, "zhilian_config",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "profile_id INTEGER, " +
                        "keywords VARCHAR(500), " +
                        "city_code VARCHAR(200), " +
                        "salary VARCHAR(50), " +
                        "search_job_limit INTEGER DEFAULT 20, " +
                        "created_at DATETIME, " +
                        "updated_at DATETIME");

        createTableIfNotExists(stmt, "zhilian_data",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "profile_id INTEGER, " +
                        "job_id VARCHAR(64), " +
                        "job_title VARCHAR(200), " +
                        "job_link VARCHAR(300), " +
                        "salary VARCHAR(100), " +
                        "location VARCHAR(100), " +
                        "experience VARCHAR(100), " +
                        "degree VARCHAR(100), " +
                        "company_name VARCHAR(200), " +
                        "delivery_status VARCHAR(20) DEFAULT '未投递', " +
                        "failure_type TEXT, " +
                        "failure_reason TEXT, " +
                        "job_description TEXT, " +
                        "scan_run_id TEXT, " +
                        "ai_score INTEGER, " +
                        "ai_decision TEXT, " +
                        "ai_reason TEXT, " +
                        "priority_company INTEGER DEFAULT 0, " +
                        "create_time DATETIME, " +
                        "update_time DATETIME");
    }

    private static void ensureProfileColumns(Statement stmt) {
        addColumn(stmt, "profile", "is_active", "INTEGER DEFAULT 0");
        addColumn(stmt, "profile", "created_at", "DATETIME");
        addColumn(stmt, "profile", "updated_at", "DATETIME");

        addColumn(stmt, "config", "config_key", "TEXT");
        addColumn(stmt, "config", "config_value", "TEXT");
        addColumn(stmt, "config", "config_type", "TEXT");
        addColumn(stmt, "config", "category", "TEXT");
        addColumn(stmt, "config", "description", "TEXT");
        addColumn(stmt, "config", "created_at", "DATETIME");
        addColumn(stmt, "config", "updated_at", "DATETIME");

        addColumn(stmt, "cookie", "platform", "TEXT");
        addColumn(stmt, "cookie", "cookie_value", "TEXT");
        addColumn(stmt, "cookie", "remark", "TEXT");
        addColumn(stmt, "cookie", "created_at", "DATETIME");
        addColumn(stmt, "cookie", "updated_at", "DATETIME");

        addProfileColumn(stmt, "ai");
        addProfileColumn(stmt, "resume_profile");
        addProfileColumn(stmt, "priority_company");
        addProfileColumn(stmt, "job_ai_analysis");
        addProfileColumn(stmt, "boss_config");
        addProfileColumn(stmt, "boss_data");
        addProfileColumn(stmt, "zhilian_config");
        addProfileColumn(stmt, "zhilian_data");
    }

    private static void ensureAiColumns(Statement stmt) {
        addColumn(stmt, "ai", "profile_id", "INTEGER");
        addColumn(stmt, "ai", "introduce", "TEXT");
        addColumn(stmt, "ai", "prompt", "TEXT");
        addColumn(stmt, "ai", "apply_threshold", "INTEGER DEFAULT 75");
        addColumn(stmt, "ai", "priority_apply_threshold", "INTEGER DEFAULT 65");
        addColumn(stmt, "ai", "created_at", "DATETIME");
        addColumn(stmt, "ai", "updated_at", "DATETIME");

        addColumn(stmt, "resume_profile", "profile_id", "INTEGER");
        addColumn(stmt, "resume_profile", "resume_text", "TEXT");
        addColumn(stmt, "resume_profile", "source_filename", "TEXT");
        addColumn(stmt, "resume_profile", "parse_status", "TEXT");
        addColumn(stmt, "resume_profile", "parse_message", "TEXT");
        addColumn(stmt, "resume_profile", "created_at", "DATETIME");
        addColumn(stmt, "resume_profile", "updated_at", "DATETIME");

        addColumn(stmt, "job_ai_analysis", "profile_id", "INTEGER");
        addColumn(stmt, "job_ai_analysis", "platform", "TEXT");
        addColumn(stmt, "job_ai_analysis", "job_key", "TEXT");
        addColumn(stmt, "job_ai_analysis", "company_name", "TEXT");
        addColumn(stmt, "job_ai_analysis", "job_name", "TEXT");
        addColumn(stmt, "job_ai_analysis", "scan_run_id", "TEXT");
        addColumn(stmt, "job_ai_analysis", "score", "INTEGER");
        addColumn(stmt, "job_ai_analysis", "decision", "TEXT");
        addColumn(stmt, "job_ai_analysis", "summary", "TEXT");
        addColumn(stmt, "job_ai_analysis", "strengths", "TEXT");
        addColumn(stmt, "job_ai_analysis", "risks", "TEXT");
        addColumn(stmt, "job_ai_analysis", "greeting", "TEXT");
        addColumn(stmt, "job_ai_analysis", "priority_company", "INTEGER DEFAULT 0");
        addColumn(stmt, "job_ai_analysis", "raw_response", "TEXT");
        addColumn(stmt, "job_ai_analysis", "created_at", "DATETIME");
        addColumn(stmt, "job_ai_analysis", "updated_at", "DATETIME");

        addColumn(stmt, "priority_company", "profile_id", "INTEGER");
        addColumn(stmt, "priority_company", "enabled", "INTEGER DEFAULT 1");
        addColumn(stmt, "priority_company", "remark", "TEXT");
        addColumn(stmt, "priority_company", "created_at", "DATETIME");
        addColumn(stmt, "priority_company", "updated_at", "DATETIME");
    }

    private static void ensurePlatformConfigColumns(Statement stmt) {
        addColumn(stmt, "boss_config", "profile_id", "INTEGER");
        addColumn(stmt, "boss_config", "debugger", "INTEGER DEFAULT 0");
        addColumn(stmt, "boss_config", "wait_time", "INTEGER DEFAULT 10");
        addColumn(stmt, "boss_config", "keywords", "VARCHAR(500)");
        addColumn(stmt, "boss_config", "city_code", "VARCHAR(200)");
        addColumn(stmt, "boss_config", "industry", "VARCHAR(200)");
        addColumn(stmt, "boss_config", "job_type", "VARCHAR(50)");
        addColumn(stmt, "boss_config", "experience", "VARCHAR(50)");
        addColumn(stmt, "boss_config", "degree", "VARCHAR(200)");
        addColumn(stmt, "boss_config", "salary", "VARCHAR(50)");
        addColumn(stmt, "boss_config", "scale", "VARCHAR(200)");
        addColumn(stmt, "boss_config", "stage", "VARCHAR(200)");
        addColumn(stmt, "boss_config", "say_hi", "TEXT");
        addColumn(stmt, "boss_config", "expected_salary_min", "INTEGER");
        addColumn(stmt, "boss_config", "expected_salary_max", "INTEGER");
        addColumn(stmt, "boss_config", "enable_ai", "INTEGER DEFAULT 1");
        addColumn(stmt, "boss_config", "send_img_resume", "INTEGER DEFAULT 0");
        addColumn(stmt, "boss_config", "filter_dead_hr", "INTEGER DEFAULT 1");
        addColumn(stmt, "boss_config", "auto_deliver", "INTEGER DEFAULT 0");
        addColumn(stmt, "boss_config", "search_job_limit", "INTEGER DEFAULT 20");
        addColumn(stmt, "boss_config", "dead_status", "VARCHAR(200)");
        addColumn(stmt, "boss_config", "created_at", "DATETIME");
        addColumn(stmt, "boss_config", "updated_at", "DATETIME");

        addColumn(stmt, "zhilian_config", "profile_id", "INTEGER");
        addColumn(stmt, "zhilian_config", "keywords", "VARCHAR(500)");
        addColumn(stmt, "zhilian_config", "city_code", "VARCHAR(200)");
        addColumn(stmt, "zhilian_config", "salary", "VARCHAR(50)");
        addColumn(stmt, "zhilian_config", "search_job_limit", "INTEGER DEFAULT 20");
        addColumn(stmt, "zhilian_config", "created_at", "DATETIME");
        addColumn(stmt, "zhilian_config", "updated_at", "DATETIME");
    }

    private static void ensurePlatformDataColumns(Statement stmt) {
        addColumn(stmt, "boss_data", "profile_id", "INTEGER");
        addColumn(stmt, "boss_data", "encrypt_id", "TEXT");
        addColumn(stmt, "boss_data", "encrypt_user_id", "TEXT");
        addColumn(stmt, "boss_data", "company_name", "TEXT");
        addColumn(stmt, "boss_data", "job_name", "TEXT");
        addColumn(stmt, "boss_data", "salary", "TEXT");
        addColumn(stmt, "boss_data", "salary_min_k", "REAL");
        addColumn(stmt, "boss_data", "salary_max_k", "REAL");
        addColumn(stmt, "boss_data", "salary_median_k", "REAL");
        addColumn(stmt, "boss_data", "salary_months", "INTEGER");
        addColumn(stmt, "boss_data", "location", "TEXT");
        addColumn(stmt, "boss_data", "experience", "TEXT");
        addColumn(stmt, "boss_data", "degree", "TEXT");
        addColumn(stmt, "boss_data", "hr_name", "TEXT");
        addColumn(stmt, "boss_data", "hr_position", "TEXT");
        addColumn(stmt, "boss_data", "hr_active_status", "TEXT");
        addColumn(stmt, "boss_data", "delivery_status", "TEXT");
        addColumn(stmt, "boss_data", "failure_type", "TEXT");
        addColumn(stmt, "boss_data", "failure_reason", "TEXT");
        addColumn(stmt, "boss_data", "job_description", "TEXT");
        addColumn(stmt, "boss_data", "job_url", "TEXT");
        addColumn(stmt, "boss_data", "recruitment_status", "TEXT");
        addColumn(stmt, "boss_data", "company_address", "TEXT");
        addColumn(stmt, "boss_data", "industry", "TEXT");
        addColumn(stmt, "boss_data", "introduce", "TEXT");
        addColumn(stmt, "boss_data", "financing_stage", "TEXT");
        addColumn(stmt, "boss_data", "company_scale", "TEXT");
        addColumn(stmt, "boss_data", "source_keyword", "TEXT");
        addColumn(stmt, "boss_data", "scan_run_id", "TEXT");
        addColumn(stmt, "boss_data", "ai_score", "INTEGER");
        addColumn(stmt, "boss_data", "ai_decision", "TEXT");
        addColumn(stmt, "boss_data", "ai_reason", "TEXT");
        addColumn(stmt, "boss_data", "priority_company", "INTEGER DEFAULT 0");
        addColumn(stmt, "boss_data", "created_at", "TEXT");
        addColumn(stmt, "boss_data", "updated_at", "TEXT");

        addColumn(stmt, "zhilian_data", "profile_id", "INTEGER");
        addColumn(stmt, "zhilian_data", "job_id", "VARCHAR(64)");
        addColumn(stmt, "zhilian_data", "job_title", "VARCHAR(200)");
        addColumn(stmt, "zhilian_data", "job_link", "VARCHAR(300)");
        addColumn(stmt, "zhilian_data", "salary", "VARCHAR(100)");
        addColumn(stmt, "zhilian_data", "location", "VARCHAR(100)");
        addColumn(stmt, "zhilian_data", "experience", "VARCHAR(100)");
        addColumn(stmt, "zhilian_data", "degree", "VARCHAR(100)");
        addColumn(stmt, "zhilian_data", "company_name", "VARCHAR(200)");
        addColumn(stmt, "zhilian_data", "delivery_status", "VARCHAR(20) DEFAULT '未投递'");
        addColumn(stmt, "zhilian_data", "failure_type", "TEXT");
        addColumn(stmt, "zhilian_data", "failure_reason", "TEXT");
        addColumn(stmt, "zhilian_data", "job_description", "TEXT");
        addColumn(stmt, "zhilian_data", "ai_score", "INTEGER");
        addColumn(stmt, "zhilian_data", "ai_decision", "TEXT");
        addColumn(stmt, "zhilian_data", "ai_reason", "TEXT");
        addColumn(stmt, "zhilian_data", "priority_company", "INTEGER DEFAULT 0");
        addColumn(stmt, "zhilian_data", "scan_run_id", "TEXT");
        addColumn(stmt, "zhilian_data", "create_time", "DATETIME");
        addColumn(stmt, "zhilian_data", "update_time", "DATETIME");
    }

    private static void backfillProfileIds(Statement stmt) {
        Long profileId = findCurrentProfileId(stmt);
        if (profileId == null) {
            return;
        }
        backfillProfileId(stmt, "ai", profileId);
        backfillProfileId(stmt, "resume_profile", profileId);
        backfillProfileId(stmt, "priority_company", profileId);
        backfillProfileId(stmt, "job_ai_analysis", profileId);
        backfillProfileId(stmt, "boss_config", profileId);
        backfillProfileId(stmt, "boss_data", profileId);
        backfillProfileId(stmt, "zhilian_config", profileId);
        backfillProfileId(stmt, "zhilian_data", profileId);
    }

    private static void createTableIfNotExists(Statement stmt, String table, String columnsSql) throws Exception {
        stmt.execute("CREATE TABLE IF NOT EXISTS " + table + " (" + columnsSql + ")");
    }

    private static void addProfileColumn(Statement stmt, String table) {
        addColumn(stmt, table, "profile_id", "INTEGER");
    }

    private static void addColumn(Statement stmt, String table, String column, String type) {
        try {
            if (tableExists(stmt, table) && !columnExists(stmt, table, column)) {
                stmt.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + type);
            }
        } catch (Exception e) {
            throw new IllegalStateException("补列失败 " + table + "." + column + ": " + e.getMessage(), e);
        }
    }

    private static void ensurePriorityCompanySchema(Statement stmt) throws Exception {
        createTableIfNotExists(stmt, "priority_company",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "profile_id INTEGER, " +
                        "company_name TEXT NOT NULL, " +
                        "enabled INTEGER DEFAULT 1, " +
                        "remark TEXT, " +
                        "created_at DATETIME, " +
                        "updated_at DATETIME, " +
                        "UNIQUE(profile_id, company_name)");

        boolean hasProfileId = columnExists(stmt, "priority_company", "profile_id");
        boolean needsRebuild = !hasProfileId || hasGlobalCompanyUnique(stmt);

        if (!needsRebuild) {
            addProfileColumn(stmt, "priority_company");
            createPriorityCompanyUniqueIndex(stmt);
            return;
        }

        stmt.execute("DROP TABLE IF EXISTS priority_company_profile_new");
        createTableIfNotExists(stmt, "priority_company_profile_new",
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                        "profile_id INTEGER, " +
                        "company_name TEXT NOT NULL, " +
                        "enabled INTEGER DEFAULT 1, " +
                        "remark TEXT, " +
                        "created_at DATETIME, " +
                        "updated_at DATETIME, " +
                        "UNIQUE(profile_id, company_name)");
        String profileExpr = hasProfileId ? "profile_id" : "NULL";
        long sourceCount = scalarCount(stmt, "priority_company");
        stmt.executeUpdate("INSERT INTO priority_company_profile_new " +
                "(id, profile_id, company_name, enabled, remark, created_at, updated_at) " +
                "SELECT id, " + profileExpr + ", company_name, enabled, remark, created_at, updated_at " +
                "FROM priority_company");
        long copiedCount = scalarCount(stmt, "priority_company_profile_new");
        if (sourceCount != copiedCount) {
            throw new IllegalStateException("priority_company 重建行数不一致: " + sourceCount + " -> " + copiedCount);
        }
        stmt.execute("DROP TABLE priority_company");
        stmt.execute("ALTER TABLE priority_company_profile_new RENAME TO priority_company");
        createPriorityCompanyUniqueIndex(stmt);
    }

    private static void createPriorityCompanyUniqueIndex(Statement stmt) {
        try {
            stmt.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_priority_company_profile_name " +
                    "ON priority_company(profile_id, company_name)");
        } catch (Exception e) {
            throw new IllegalStateException("创建重点公司唯一索引失败: " + e.getMessage(), e);
        }
    }

    private static void ensureIndexes(Statement stmt) {
        createIndexIfNotExists(stmt,
                "idx_boss_data_profile_run_encrypt",
                "boss_data",
                "profile_id, scan_run_id, encrypt_id");
        createIndexIfNotExists(stmt,
                "idx_boss_data_profile_delivery_status",
                "boss_data",
                "profile_id, delivery_status");
        createIndexIfNotExists(stmt,
                "idx_boss_data_profile_created_at",
                "boss_data",
                "profile_id, created_at");
        createIndexIfNotExists(stmt,
                "idx_boss_data_profile_company_job",
                "boss_data",
                "profile_id, company_name, job_name");
        createIndexIfNotExists(stmt,
                "idx_job_ai_analysis_profile_platform_job_run",
                "job_ai_analysis",
                "profile_id, platform, job_key, scan_run_id");
    }

    private static void createIndexIfNotExists(Statement stmt, String indexName, String table, String columnsSql) {
        try {
            if (tableExists(stmt, table)) {
                stmt.execute("CREATE INDEX IF NOT EXISTS " + indexName + " ON " + table + "(" + columnsSql + ")");
            }
        } catch (Exception e) {
            throw new IllegalStateException("创建索引失败 " + table + "." + indexName + ": " + e.getMessage(), e);
        }
    }

    private static boolean hasGlobalCompanyUnique(Statement stmt) {
        try (Statement indexStatement = stmt.getConnection().createStatement();
             ResultSet indexes = indexStatement.executeQuery("PRAGMA index_list('priority_company')")) {
            while (indexes.next()) {
                if (indexes.getInt("unique") != 1) {
                    continue;
                }
                String indexName = indexes.getString("name");
                try (Statement columnStatement = stmt.getConnection().createStatement();
                     ResultSet columns = columnStatement.executeQuery("PRAGMA index_info('" + indexName.replace("'", "''") + "')")) {
                    int count = 0;
                    boolean companyNameOnly = true;
                    while (columns.next()) {
                        count++;
                        companyNameOnly &= "company_name".equalsIgnoreCase(columns.getString("name"));
                    }
                    if (count == 1 && companyNameOnly) {
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            throw new IllegalStateException("检查 priority_company 唯一约束失败: " + e.getMessage(), e);
        }
        return false;
    }

    private static void normalizeActiveProfile(Statement stmt) {
        try {
            Long activeId = null;
            try (ResultSet rs = stmt.executeQuery("SELECT id FROM profile WHERE is_active = 1 ORDER BY id ASC LIMIT 1")) {
                if (rs.next()) {
                    activeId = rs.getLong("id");
                }
            }
            if (activeId == null) {
                try (ResultSet rs = stmt.executeQuery("SELECT id FROM profile ORDER BY id ASC LIMIT 1")) {
                    if (rs.next()) {
                        activeId = rs.getLong("id");
                    }
                }
            }
            if (activeId != null) {
                stmt.executeUpdate("UPDATE profile SET is_active = CASE WHEN id = " + activeId + " THEN 1 ELSE 0 END");
            }
        } catch (Exception e) {
            throw new IllegalStateException("规范化当前档案失败: " + e.getMessage(), e);
        }
    }

    private static Long findCurrentProfileId(Statement stmt) {
        try (ResultSet rs = stmt.executeQuery("SELECT id FROM profile WHERE is_active = 1 ORDER BY id ASC LIMIT 1")) {
            if (rs.next()) {
                return rs.getLong("id");
            }
        } catch (Exception e) {
            throw new IllegalStateException("查询当前档案失败: " + e.getMessage(), e);
        }
        try (ResultSet rs = stmt.executeQuery("SELECT id FROM profile ORDER BY id ASC LIMIT 1")) {
            if (rs.next()) {
                return rs.getLong("id");
            }
        } catch (Exception e) {
            throw new IllegalStateException("查询首个档案失败: " + e.getMessage(), e);
        }
        return null;
    }

    private static void backfillProfileId(Statement stmt, String table, Long profileId) {
        try {
            if (tableExists(stmt, table) && columnExists(stmt, table, "profile_id")) {
                stmt.executeUpdate("UPDATE " + table + " SET profile_id = " + profileId + " WHERE profile_id IS NULL");
            }
        } catch (Exception e) {
            throw new IllegalStateException("回填 " + table + ".profile_id 失败: " + e.getMessage(), e);
        }
    }

    private static long scalarCount(Statement stmt, String table) throws SQLException {
        try (ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM " + table)) {
            return rs.next() ? rs.getLong(1) : 0L;
        }
    }

    public static void validateSchema(Connection conn) throws SQLException {
        validateSchema(conn, true);
    }

    public static void validateSchemaBeforeV7(Connection conn) throws SQLException {
        validateSchema(conn, false);
    }

    private static void validateSchema(Connection conn, boolean requireV7TaskSchema) throws SQLException {
        List<String> requiredTables = new ArrayList<>(List.of(
                "profile", "config", "cookie", "ai", "resume_profile", "priority_company",
                "job_ai_analysis", "job_analysis_task", "boss_config", "boss_data",
                "boss_blacklist", "boss_option", "boss_industry", "zhilian_config",
                "zhilian_data", "zhilian_option", "liepin_config", "liepin_data",
                "liepin_option", "job51_config", "job51_data", "job51_option"
        ));
        Map<String, Set<String>> requiredColumns = new LinkedHashMap<>();
        requiredColumns.put("profile", Set.of("id", "is_active"));
        requiredColumns.put("config", Set.of("config_key", "config_value"));
        requiredColumns.put("cookie", Set.of("platform", "cookie_value"));
        requiredColumns.put("ai", Set.of("profile_id", "apply_threshold", "priority_apply_threshold"));
        requiredColumns.put("priority_company", Set.of("profile_id", "company_name"));
        requiredColumns.put("boss_data", Set.of(
                "profile_id", "encrypt_id", "encrypt_user_id", "delivery_status", "failure_type",
                "failure_reason", "scan_run_id", "source_keyword", "salary_min_k", "salary_max_k",
                "salary_median_k", "salary_months"
        ));
        requiredColumns.put("zhilian_data", Set.of("profile_id", "job_id", "delivery_status", "scan_run_id"));
        requiredColumns.put("liepin_data", Set.of("job_id", "delivered"));
        requiredColumns.put("job51_data", Set.of("job_id", "delivered"));
        if (requireV7TaskSchema) {
            requiredTables.add("delivery_attempt");
            requiredColumns.put("liepin_config", Set.of("id", "profile_id"));
            requiredColumns.put("job51_config", Set.of("id", "profile_id"));
            requiredColumns.put("liepin_data", Set.of("id", "profile_id", "job_id", "delivered", "delivery_status"));
            requiredColumns.put("job51_data", Set.of("id", "profile_id", "job_id", "delivered", "delivery_status"));
            requiredColumns.put("delivery_attempt", Set.of(
                    "request_key", "platform", "profile_id", "job_key", "job_row_id", "state",
                    "evidence", "message", "requested_at", "resolved_at", "updated_at"));
        }
        requiredColumns.put("job_analysis_task", requireV7TaskSchema
                ? Set.of(
                "profile_id", "platform", "status", "scan_run_id", "task_key", "job_key",
                "job_row_id", "request_json", "attempt_count", "next_retry_at", "lease_owner",
                "lease_expires_at", "last_error", "started_at", "completed_at"
        )
                : Set.of("profile_id", "platform", "status", "scan_run_id"));
        List<String> requiredIndexes = new ArrayList<>(List.of(
                "idx_priority_company_profile_name",
                "idx_boss_blacklist_type_value",
                "idx_boss_option_type_code",
                "idx_boss_industry_code",
                "idx_boss_data_profile_run_encrypt",
                "idx_boss_data_profile_delivery_status",
                "idx_boss_data_profile_created_at",
                "idx_boss_data_profile_company_job",
                "idx_job_ai_analysis_profile_platform_job_run",
                "idx_zhilian_data_profile_scan_run",
                "idx_liepin_data_company_job",
                "idx_job51_data_company_job",
                "idx_job_analysis_task_profile_platform_status",
                 "idx_job_analysis_task_scan_run"
        ));
        if (requireV7TaskSchema) {
            requiredIndexes.addAll(List.of(
                    "idx_job_analysis_task_task_key",
                    "idx_job_analysis_task_active_job",
                    "idx_job_analysis_task_dispatch",
                    "idx_job_analysis_task_lease",
                    "idx_liepin_data_profile_company_job",
                    "idx_job51_data_profile_company_job",
                    "idx_liepin_data_profile_status",
                    "idx_job51_data_profile_status",
                    "idx_delivery_attempt_profile_state"
            ));
        }

        try (Statement stmt = conn.createStatement()) {
            for (String table : requiredTables) {
                if (!tableExists(stmt, table)) {
                    throw new SQLException("缺少必要数据表: " + table);
                }
            }
            for (Map.Entry<String, Set<String>> entry : requiredColumns.entrySet()) {
                for (String column : entry.getValue()) {
                    if (!columnExists(stmt, entry.getKey(), column)) {
                        throw new SQLException("缺少必要字段: " + entry.getKey() + "." + column);
                    }
                }
            }
            for (String index : requiredIndexes) {
                if (!indexExists(stmt, index)) {
                    throw new SQLException("缺少必要索引: " + index);
                }
            }
            if (requireV7TaskSchema) {
                requireProfileConstraint(conn, "liepin_config", List.of("profile_id"));
                requireProfileConstraint(conn, "job51_config", List.of("profile_id"));
                requireProfileConstraint(conn, "liepin_data", List.of("profile_id", "job_id"));
                requireProfileConstraint(conn, "job51_data", List.of("profile_id", "job_id"));
            }
        } catch (SQLException e) {
            throw e;
        } catch (Exception e) {
            throw new SQLException("Schema 校验失败: " + e.getMessage(), e);
        }
    }

    private static boolean tableExists(Statement stmt, String table) throws Exception {
        try (ResultSet rs = stmt.executeQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name='" + table + "' LIMIT 1")) {
            return rs.next();
        }
    }

    private static boolean indexExists(Statement stmt, String index) throws Exception {
        try (ResultSet rs = stmt.executeQuery(
                "SELECT 1 FROM sqlite_master WHERE type='index' AND name='" + index + "' LIMIT 1")) {
            return rs.next();
        }
    }

    private static boolean columnExists(Statement stmt, String table, String column) throws Exception {
        try (ResultSet rs = stmt.executeQuery("PRAGMA table_info('" + table + "')")) {
            while (rs.next()) {
                if (column.equalsIgnoreCase(rs.getString("name"))) {
                    return true;
                }
            }
        }
        return false;
    }

    private static void requireProfileConstraint(Connection connection,
                                                 String table,
                                                 List<String> uniqueColumns) throws SQLException {
        if (!hasUniqueIndex(connection, table, uniqueColumns)) {
            throw new SQLException("缺少必要唯一约束: " + table + uniqueColumns);
        }
        try (Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery("PRAGMA foreign_key_list('" + table + "')")) {
            while (resultSet.next()) {
                if ("profile".equalsIgnoreCase(resultSet.getString("table"))
                        && "profile_id".equalsIgnoreCase(resultSet.getString("from"))) {
                    return;
                }
            }
        }
        throw new SQLException("缺少必要外键: " + table + ".profile_id -> profile.id");
    }

    private static boolean hasUniqueIndex(Connection connection,
                                          String table,
                                          List<String> expectedColumns) throws SQLException {
        List<String> indexNames = new ArrayList<>();
        try (Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery("PRAGMA index_list('" + table + "')")) {
            while (resultSet.next()) {
                if (resultSet.getInt("unique") == 1) {
                    indexNames.add(resultSet.getString("name"));
                }
            }
        }
        for (String indexName : indexNames) {
            List<String> columns = new ArrayList<>();
            try (Statement statement = connection.createStatement();
                 ResultSet resultSet = statement.executeQuery(
                         "PRAGMA index_info('" + indexName.replace("'", "''") + "')")) {
                while (resultSet.next()) {
                    columns.add(resultSet.getString("name"));
                }
            }
            if (columns.equals(expectedColumns)) {
                return true;
            }
        }
        return false;
    }
}
