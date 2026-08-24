package com.getjobs.application.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 判断应用能否安全接收新任务。这里只检查本地依赖，不访问浏览器或付费 Provider。
 */
@Service
@RequiredArgsConstructor
public class ApplicationReadinessService {
    private final DataSource dataSource;
    private final ChromeJobAnalysisQueueService analysisQueueService;

    public ReadinessReport check() {
        Map<String, Object> checks = new LinkedHashMap<>();
        boolean databaseReady = checkDatabase(checks);
        boolean queueReady = checkQueue(checks);
        boolean ready = databaseReady && queueReady;
        return new ReadinessReport(ready, ready ? "UP" : "DOWN", checks);
    }

    private boolean checkDatabase(Map<String, Object> checks) {
        try (Connection connection = dataSource.getConnection();
             Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery("SELECT 1")) {
            if (!resultSet.next() || resultSet.getInt(1) != 1) {
                checks.put("database", Map.of("status", "DOWN", "message", "数据库探测未返回有效结果"));
                return false;
            }
            DatabaseSchemaService.validateSchema(connection);
            checks.put("database", Map.of("status", "UP", "schema", "VALID"));
            return true;
        } catch (Exception exception) {
            checks.put("database", Map.of(
                    "status", "DOWN",
                    "message", safeMessage(exception, "数据库或 Schema 不可用")
            ));
            return false;
        }
    }

    private boolean checkQueue(Map<String, Object> checks) {
        try {
            ChromeJobAnalysisQueueService.QueueHealth health = analysisQueueService.healthSnapshot();
            checks.put("analysisQueue", Map.of(
                    "status", health.accepting() ? "UP" : "DOWN",
                    "accepting", health.accepting(),
                    "stopping", health.stopping(),
                    "outstandingTasks", health.outstandingTasks(),
                    "activeWorkers", health.activeWorkers(),
                    "localQueueSize", health.localQueueSize(),
                    "remainingLocalCapacity", health.remainingLocalCapacity()
            ));
            return health.accepting();
        } catch (Exception exception) {
            checks.put("analysisQueue", Map.of(
                    "status", "DOWN",
                    "message", safeMessage(exception, "持久任务执行器不可用")
            ));
            return false;
        }
    }

    private String safeMessage(Exception exception, String fallback) {
        String message = exception.getMessage();
        return message == null || message.isBlank() ? fallback : message;
    }

    public record ReadinessReport(boolean ready, String status, Map<String, Object> checks) {
    }
}
