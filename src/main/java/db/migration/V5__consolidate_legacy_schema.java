package db.migration;

import com.getjobs.application.service.DatabaseSchemaService;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Statement;

/**
 * 将历史运行时补表/补列逻辑收敛到一次性 Flyway 迁移。
 *
 * <p>旧的非空数据库可能被 baseline 为 v4 而没有实际执行 V1-V4。本迁移会先用
 * CREATE IF NOT EXISTS 补齐历史表，再补运行时漂移列和全部索引。</p>
 */
public class V5__consolidate_legacy_schema extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        executeResource(context, "db/migration/V1__init_schema.sql");
        executeResource(context, "db/migration/V4__add_job_analysis_task.sql");
        DatabaseSchemaService.migrateLegacySchema(context.getConnection());
        executeResource(context, "db/migration/V2__add_indexes.sql");
        DatabaseSchemaService.validateSchema(context.getConnection());
    }

    private void executeResource(Context context, String resourcePath) throws Exception {
        String script = readResource(resourcePath);
        try (Statement statement = context.getConnection().createStatement()) {
            for (String sql : script.split(";")) {
                String trimmed = sql.trim();
                if (!trimmed.isEmpty()) {
                    statement.execute(trimmed);
                }
            }
        }
    }

    private String readResource(String resourcePath) throws IOException {
        ClassLoader classLoader = Thread.currentThread().getContextClassLoader();
        try (InputStream input = classLoader.getResourceAsStream(resourcePath)) {
            if (input == null) {
                throw new IOException("找不到迁移资源: " + resourcePath);
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
