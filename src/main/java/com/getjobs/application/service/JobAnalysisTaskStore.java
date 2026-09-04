package com.getjobs.application.service;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.DependsOn;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Chrome 岗位 AI 分析任务的持久事实源。线程池只是消费者，任务是否存在以本表为准。
 */
@Service
@RequiredArgsConstructor
@DependsOn("databaseSchemaService")
public class JobAnalysisTaskStore {
    public static final int MAX_OUTSTANDING_TASKS = 200;
    public static final Duration MAX_EXECUTION_DURATION = Duration.ofMinutes(65);
    private static final Set<String> SUPPORTED_PLATFORMS = Set.of("boss", "zhilian");
    private static final DateTimeFormatter DB_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS");

    private final JdbcTemplate jdbcTemplate;
    private final PlatformTransactionManager transactionManager;
    private final ObjectMapper objectMapper;

    private static final RowMapper<TaskRecord> TASK_MAPPER = (rs, rowNum) -> new TaskRecord(
            rs.getLong("id"),
            nullableLong(rs.getObject("profile_id")),
            rs.getString("platform"),
            rs.getString("job_key"),
            nullableLong(rs.getObject("job_row_id")),
            rs.getString("scan_run_id"),
            rs.getString("status"),
            rs.getInt("attempt_count"),
            rs.getString("request_json"),
            rs.getString("lease_owner"),
            rs.getString("lease_expires_at"),
            rs.getString("last_error"),
            rs.getString("created_at"),
            rs.getString("updated_at"),
            rs.getString("started_at"),
            rs.getString("completed_at")
    );

    @PostConstruct
    public void validateSchema() {
        List<String> requiredColumns = List.of(
                "task_key", "job_key", "job_row_id", "request_json", "attempt_count",
                "next_retry_at", "lease_owner", "lease_expires_at", "last_error",
                "started_at", "completed_at"
        );
        for (String column : requiredColumns) {
            Integer count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM pragma_table_info('job_analysis_task') WHERE name=?",
                    Integer.class,
                    column
            );
            if (count == null || count != 1) {
                throw new IllegalStateException("AI 分析任务 schema 不完整，缺少字段: " + column);
            }
        }
        for (String index : List.of(
                "idx_job_analysis_task_task_key",
                "idx_job_analysis_task_active_job",
                "idx_job_analysis_task_dispatch",
                "idx_job_analysis_task_lease"
        )) {
            Integer count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?",
                    Integer.class,
                    index
            );
            if (count == null || count != 1) {
                throw new IllegalStateException("AI 分析任务 schema 不完整，缺少索引: " + index);
            }
        }
    }

    public SubmitResult submit(JobAiAnalysisService.JobAnalysisRequest request) {
        validateRequest(request);
        String platform = normalizePlatform(request.getPlatform());
        String jobKey = stableJobKey(request);
        validateTargetJobIdentity(request, platform, jobKey);
        String taskKey = taskKey(request, platform, jobKey);
        String requestJson = serialize(request);
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        return transaction.execute(status -> {
            TaskRecord exact = findByTaskKey(taskKey);
            if (exact != null) {
                return SubmitResult.existing(exact, duplicateMessage(exact));
            }
            TaskRecord active = findActive(request.getProfileId(), platform, jobKey);
            if (active != null) {
                return SubmitResult.existing(active, "该岗位已有待执行或执行中的 AI 任务");
            }
            if (outstandingCount() >= MAX_OUTSTANDING_TASKS) {
                return SubmitResult.rejected("持久 AI 任务队列已满，请等待现有任务完成");
            }

            String now = dbTime(LocalDateTime.now());
            int inserted;
            try {
                inserted = jdbcTemplate.update("INSERT OR IGNORE INTO job_analysis_task (" +
                                "profile_id, platform, scan_run_id, status, total_count, processed_count, " +
                                "success_count, failed_count, message, created_at, updated_at, task_key, job_key, " +
                                "job_row_id, request_json, attempt_count) " +
                                "VALUES (?, ?, ?, 'PENDING', 1, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, 0)",
                        request.getProfileId(), platform, blankToNull(request.getScanRunId()),
                        "已持久化，等待 AI 分析", now, now, taskKey, jobKey,
                        request.getJobRowId(), requestJson);
            } catch (DataAccessException e) {
                inserted = 0;
            }
            TaskRecord stored = findByTaskKey(taskKey);
            if (stored == null) {
                stored = findActive(request.getProfileId(), platform, jobKey);
            }
            if (inserted == 1 && stored != null) {
                return SubmitResult.created(stored);
            }
            if (stored != null) {
                return SubmitResult.existing(stored, "该岗位任务已被并发创建");
            }
            status.setRollbackOnly();
            return SubmitResult.rejected("AI 分析任务持久化失败");
        });
    }

    public SubmitResult recordUnknown(JobAiAnalysisService.JobAnalysisRequest request, String message) {
        validateRequest(request);
        String platform = normalizePlatform(request.getPlatform());
        String jobKey = stableJobKey(request);
        validateTargetJobIdentity(request, platform, jobKey);
        String taskKey = taskKey(request, platform, jobKey);
        String requestJson = serialize(request);
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        return transaction.execute(status -> {
            TaskRecord exact = findByTaskKey(taskKey);
            if (exact != null) return SubmitResult.existing(exact, duplicateMessage(exact));
            TaskRecord active = findActive(request.getProfileId(), platform, jobKey);
            if (active != null) return SubmitResult.existing(active, "该岗位已有持久 AI 任务");

            String now = dbTime(LocalDateTime.now());
            int inserted = jdbcTemplate.update("INSERT OR IGNORE INTO job_analysis_task (" +
                            "profile_id, platform, scan_run_id, status, total_count, processed_count, " +
                            "success_count, failed_count, message, created_at, updated_at, task_key, job_key, " +
                            "job_row_id, request_json, attempt_count, last_error) " +
                            "VALUES (?, ?, ?, 'UNKNOWN', 1, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
                    request.getProfileId(), platform, blankToNull(request.getScanRunId()),
                    message, now, now, taskKey, jobKey, request.getJobRowId(), requestJson, message);
            TaskRecord stored = findByTaskKey(taskKey);
            if (inserted == 1 && stored != null) return SubmitResult.created(stored);
            if (stored != null) return SubmitResult.existing(stored, "该岗位恢复任务已存在");
            status.setRollbackOnly();
            return SubmitResult.rejected("无法登记遗留 AI 分析中任务");
        });
    }

    public List<JobAiAnalysisService.JobAnalysisRequest> listOrphanedAnalyzingRequests(int limit) {
        int safeLimit = Math.max(1, Math.min(limit, MAX_OUTSTANDING_TASKS));
        List<JobAiAnalysisService.JobAnalysisRequest> requests = new java.util.ArrayList<>();
        requests.addAll(jdbcTemplate.query("SELECT b.id, b.profile_id, b.encrypt_id AS job_key, " +
                        "b.source_keyword AS keyword, b.company_name, b.job_name, b.salary, b.location, " +
                        "b.experience, b.degree, b.introduce AS company_info, b.job_description, b.scan_run_id " +
                        "FROM boss_data b WHERE b.delivery_status=? AND b.profile_id IS NOT NULL " +
                        "AND NOT EXISTS (SELECT 1 FROM job_analysis_task t WHERE t.task_key IS NOT NULL " +
                        "AND lower(t.platform)='boss' AND t.profile_id=b.profile_id AND t.job_row_id=b.id " +
                        ") " +
                        "ORDER BY b.id LIMIT ?",
                (rs, rowNum) -> analysisRequest(
                        "boss", rs.getLong("id"), rs.getLong("profile_id"), rs.getString("job_key"),
                        rs.getString("keyword"), rs.getString("company_name"), rs.getString("job_name"),
                        rs.getString("salary"), rs.getString("location"), rs.getString("experience"),
                        rs.getString("degree"), rs.getString("company_info"), rs.getString("job_description"),
                        rs.getString("scan_run_id")
                ), DeliveryStatus.AI_ANALYZING, safeLimit));
        int remaining = safeLimit - requests.size();
        if (remaining > 0) {
            requests.addAll(jdbcTemplate.query("SELECT z.id, z.profile_id, z.job_id AS job_key, " +
                            "z.company_name, z.job_title AS job_name, z.salary, z.location, z.experience, " +
                            "z.degree, z.job_description, z.scan_run_id FROM zhilian_data z " +
                            "WHERE z.delivery_status=? AND z.profile_id IS NOT NULL " +
                            "AND NOT EXISTS (SELECT 1 FROM job_analysis_task t WHERE t.task_key IS NOT NULL " +
                            "AND lower(t.platform)='zhilian' AND t.profile_id=z.profile_id AND t.job_row_id=z.id " +
                            ") " +
                            "ORDER BY z.id LIMIT ?",
                    (rs, rowNum) -> analysisRequest(
                            "zhilian", rs.getLong("id"), rs.getLong("profile_id"), rs.getString("job_key"),
                            "", rs.getString("company_name"), rs.getString("job_name"),
                            rs.getString("salary"), rs.getString("location"), rs.getString("experience"),
                            rs.getString("degree"), "", rs.getString("job_description"),
                            rs.getString("scan_run_id")
                    ), DeliveryStatus.AI_ANALYZING, remaining));
        }
        return List.copyOf(requests);
    }

    public List<TaskRecord> listDuePending(int limit) {
        int safeLimit = Math.max(1, Math.min(limit, MAX_OUTSTANDING_TASKS));
        return jdbcTemplate.query("SELECT " + selectColumns() + " FROM job_analysis_task " +
                        "WHERE task_key IS NOT NULL AND request_json IS NOT NULL AND status='PENDING' " +
                        "AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY id LIMIT ?",
                TASK_MAPPER, dbTime(LocalDateTime.now()), safeLimit);
    }

    public List<TaskRecord> listCompatibleDuePending(long profileId, String platform, int limit) {
        int safeLimit = Math.max(1, Math.min(limit, JobAiAnalysisService.MAX_BATCH_SIZE - 1));
        return jdbcTemplate.query("SELECT " + selectColumns() + " FROM job_analysis_task " +
                        "WHERE profile_id=? AND lower(platform)=? AND task_key IS NOT NULL " +
                        "AND request_json IS NOT NULL AND status='PENDING' " +
                        "AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY id LIMIT ?",
                TASK_MAPPER,
                profileId,
                normalizePlatform(platform),
                dbTime(LocalDateTime.now()),
                safeLimit);
    }

    public List<TaskRecord> listExpiredLeases(int limit) {
        int safeLimit = Math.max(1, Math.min(limit, MAX_OUTSTANDING_TASKS));
        return jdbcTemplate.query("SELECT " + selectColumns() + " FROM job_analysis_task " +
                        "WHERE task_key IS NOT NULL AND request_json IS NOT NULL AND status='LEASED' " +
                        "AND lease_expires_at IS NOT NULL AND lease_expires_at<=? ORDER BY lease_expires_at LIMIT ?",
                TASK_MAPPER, dbTime(LocalDateTime.now()), safeLimit);
    }

    public TaskRecord claim(long taskId, String leaseToken, Duration leaseDuration) {
        if (leaseToken == null || leaseToken.isBlank()) {
            throw new IllegalArgumentException("leaseToken 不能为空");
        }
        Duration safeDuration = leaseDuration == null || leaseDuration.isNegative() || leaseDuration.isZero()
                ? Duration.ofMinutes(15)
                : leaseDuration;
        LocalDateTime now = LocalDateTime.now();
        String nowText = dbTime(now);
        String leaseExpiry = dbTime(min(now.plus(safeDuration), now.plus(MAX_EXECUTION_DURATION)));
        int changed = jdbcTemplate.update("UPDATE job_analysis_task SET status='LEASED', lease_owner=?, " +
                        "lease_expires_at=?, attempt_count=attempt_count+1, started_at=?, updated_at=?, " +
                        "message='AI 分析执行中', last_error=NULL WHERE id=? AND status='PENDING' " +
                        "AND task_key IS NOT NULL AND request_json IS NOT NULL " +
                        "AND (next_retry_at IS NULL OR next_retry_at<=?)",
                leaseToken, leaseExpiry, nowText, nowText, taskId, nowText);
        return changed == 1 ? findById(taskId) : null;
    }

    public boolean renewLease(long taskId, String leaseToken, Duration leaseDuration) {
        if (leaseToken == null || leaseToken.isBlank()) return false;
        Duration safeDuration = leaseDuration == null || leaseDuration.isNegative() || leaseDuration.isZero()
                ? Duration.ofMinutes(5)
                : leaseDuration;
        TaskRecord current = findById(taskId);
        if (current == null || current.statusEnum() != Status.LEASED
                || !leaseToken.equals(current.leaseOwner())) {
            return false;
        }
        LocalDateTime startedAt = parseDbTime(current.startedAt());
        if (startedAt == null) return false;
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime hardDeadline = startedAt.plus(MAX_EXECUTION_DURATION);
        if (!now.isBefore(hardDeadline)) return false;
        String nowText = dbTime(now);
        String leaseExpiry = dbTime(min(now.plus(safeDuration), hardDeadline));
        return jdbcTemplate.update("UPDATE job_analysis_task SET lease_expires_at=?, updated_at=? " +
                        "WHERE id=? AND status='LEASED' AND lease_owner=? AND started_at=?",
                leaseExpiry, nowText, taskId, leaseToken, current.startedAt()) == 1;
    }

    public boolean isLeaseOwner(long taskId, String leaseToken) {
        if (leaseToken == null || leaseToken.isBlank()) return false;
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM job_analysis_task WHERE id=? AND status='LEASED' AND lease_owner=? " +
                        "AND lease_expires_at IS NOT NULL AND lease_expires_at>?",
                Integer.class,
                taskId,
                leaseToken,
                dbTime(LocalDateTime.now())
        );
        return count != null && count == 1;
    }

    /**
     * 在持有 SQLite 写事务期间验证租约并执行结果写入，避免“校验通过后租约立刻失效”的竞态。
     */
    public boolean executeWithLease(long taskId, String leaseToken, Runnable action) {
        if (leaseToken == null || leaseToken.isBlank() || action == null) return false;
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        Boolean executed = transaction.execute(status -> {
            String now = dbTime(LocalDateTime.now());
            int locked = jdbcTemplate.update("UPDATE job_analysis_task SET updated_at=updated_at " +
                            "WHERE id=? AND status='LEASED' AND lease_owner=? " +
                            "AND lease_expires_at IS NOT NULL AND lease_expires_at>?",
                    taskId, leaseToken, now);
            if (locked != 1) return false;
            action.run();
            return true;
        });
        return Boolean.TRUE.equals(executed);
    }

    public boolean complete(long taskId, String leaseToken, boolean failed, String message) {
        String target = failed ? Status.FAILED.name() : Status.SUCCEEDED.name();
        String now = dbTime(LocalDateTime.now());
        int changed = jdbcTemplate.update("UPDATE job_analysis_task SET status=?, processed_count=1, " +
                        "success_count=?, failed_count=?, message=?, last_error=?, completed_at=?, updated_at=?, " +
                        "lease_expires_at=NULL WHERE id=? AND status='LEASED' AND lease_owner=? " +
                        "AND lease_expires_at IS NOT NULL AND lease_expires_at>?",
                target, failed ? 0 : 1, failed ? 1 : 0,
                firstNonBlank(message, failed ? "AI 分析失败" : "AI 分析完成"),
                failed ? firstNonBlank(message, "AI 分析失败") : null,
                now, now, taskId, leaseToken, now);
        return changed == 1;
    }

    public boolean completeUnknown(long taskId, String leaseToken, String message) {
        String now = dbTime(LocalDateTime.now());
        int changed = jdbcTemplate.update("UPDATE job_analysis_task SET status='UNKNOWN', processed_count=0, " +
                        "success_count=0, failed_count=0, message=?, last_error=?, completed_at=NULL, updated_at=?, " +
                        "lease_expires_at=NULL WHERE id=? AND status='LEASED' AND lease_owner=? " +
                        "AND lease_expires_at IS NOT NULL AND lease_expires_at>?",
                firstNonBlank(message, "AI Provider 结果未知，需要人工确认"),
                firstNonBlank(message, "AI Provider 结果未知，需要人工确认"),
                now, taskId, leaseToken, now);
        return changed == 1;
    }

    public boolean reconcileExpired(long taskId,
                                    String leaseToken,
                                    Status target,
                                    String message) {
        return reconcileExpired(taskId, leaseToken, target, message, null);
    }

    public boolean reconcileExpired(long taskId,
                                    String leaseToken,
                                    Status target,
                                    String message,
                                    Runnable afterReconcile) {
        if (target != Status.SUCCEEDED && target != Status.FAILED && target != Status.UNKNOWN) {
            throw new IllegalArgumentException("过期租约只能对账为 SUCCEEDED、FAILED 或 UNKNOWN");
        }
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        Boolean reconciled = transaction.execute(status -> {
            String now = dbTime(LocalDateTime.now());
            boolean terminal = target == Status.SUCCEEDED || target == Status.FAILED;
            int changed = jdbcTemplate.update("UPDATE job_analysis_task SET status=?, processed_count=?, " +
                            "success_count=?, failed_count=?, message=?, last_error=?, completed_at=?, updated_at=?, " +
                            "lease_expires_at=NULL WHERE id=? AND status='LEASED' AND lease_owner=? " +
                            "AND lease_expires_at IS NOT NULL AND lease_expires_at<=?",
                    target.name(), terminal ? 1 : 0,
                    target == Status.SUCCEEDED ? 1 : 0,
                    target == Status.FAILED ? 1 : 0,
                    message,
                    target == Status.SUCCEEDED ? null : message,
                    terminal ? now : null,
                    now, taskId, leaseToken, now);
            if (changed != 1) return false;
            if (afterReconcile != null) afterReconcile.run();
            return true;
        });
        return Boolean.TRUE.equals(reconciled);
    }

    public boolean reconcileUnknown(long taskId,
                                    String leaseToken,
                                    Status target,
                                    String message) {
        if (target != Status.SUCCEEDED && target != Status.FAILED) {
            throw new IllegalArgumentException("UNKNOWN 只能对账为 SUCCEEDED 或 FAILED");
        }
        String now = dbTime(LocalDateTime.now());
        int changed = jdbcTemplate.update("UPDATE job_analysis_task SET status=?, processed_count=1, " +
                        "success_count=?, failed_count=?, message=?, last_error=?, completed_at=?, updated_at=? " +
                        "WHERE id=? AND status='UNKNOWN' AND lease_owner=?",
                target.name(), target == Status.SUCCEEDED ? 1 : 0, target == Status.FAILED ? 1 : 0,
                message, target == Status.FAILED ? message : null, now, now, taskId, leaseToken);
        return changed == 1;
    }

    public RetryResult retry(long taskId, long profileId) {
        return retry(taskId, profileId, false);
    }

    public RetryResult retry(long taskId, long profileId, boolean confirmUnknown) {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        return transaction.execute(status -> {
            TaskRecord current = findByIdAndProfile(taskId, profileId);
            if (current == null) {
                return RetryResult.rejected("AI 分析任务不存在或不属于当前档案");
            }
            Status state = current.statusEnum();
            if (state != Status.FAILED && state != Status.UNKNOWN) {
                return RetryResult.rejected("仅 FAILED 或 UNKNOWN 任务允许显式重试");
            }
            if (state == Status.UNKNOWN && !confirmUnknown) {
                return RetryResult.rejected("UNKNOWN 任务可能已经产生外部调用，请确认平台结果并使用 confirmUnknown=true 后再重试");
            }
            TaskRecord active = findActive(current.profileId(), current.platform(), current.jobKey());
            if (active != null && active.id() != current.id()) {
                return RetryResult.rejected("该岗位已有待执行或执行中的 AI 任务");
            }
            String now = dbTime(LocalDateTime.now());
            int changed = jdbcTemplate.update("UPDATE job_analysis_task SET status='PENDING', " +
                            "processed_count=0, success_count=0, failed_count=0, message='用户已显式重试，等待 AI 分析', " +
                            "next_retry_at=NULL, lease_owner=NULL, lease_expires_at=NULL, last_error=NULL, " +
                            "started_at=NULL, completed_at=NULL, updated_at=? WHERE id=? AND profile_id=? " +
                            "AND status IN ('FAILED', 'UNKNOWN')",
                    now, taskId, profileId);
            if (changed != 1) {
                status.setRollbackOnly();
                return RetryResult.rejected("任务状态已被并发更新，请刷新后重试");
            }
            return RetryResult.accepted(findById(taskId));
        });
    }

    public List<TaskView> listRecent(long profileId, int limit) {
        return listRecent(profileId, null, limit);
    }

    public List<TaskView> listRecent(long profileId, String platform, int limit) {
        int safeLimit = Math.max(1, Math.min(limit, 200));
        if (platform != null && !platform.isBlank()) {
            return jdbcTemplate.query("SELECT " + selectColumns() + " FROM job_analysis_task " +
                            "WHERE profile_id=? AND lower(platform)=? AND task_key IS NOT NULL " +
                            "ORDER BY id DESC LIMIT ?",
                    TASK_MAPPER, profileId, normalizePlatform(platform), safeLimit)
                    .stream().map(TaskRecord::toView).toList();
        }
        return jdbcTemplate.query("SELECT " + selectColumns() + " FROM job_analysis_task " +
                        "WHERE profile_id=? AND task_key IS NOT NULL ORDER BY id DESC LIMIT ?",
                TASK_MAPPER, profileId, safeLimit).stream().map(TaskRecord::toView).toList();
    }

    public int outstandingCount() {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM job_analysis_task WHERE task_key IS NOT NULL AND status IN ('PENDING','LEASED')",
                Integer.class
        );
        return count == null ? 0 : count;
    }

    public int outstandingCount(long profileId) {
        return outstandingCount(profileId, null);
    }

    public int outstandingCount(long profileId, String platform) {
        if (platform != null && !platform.isBlank()) {
            Integer count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM job_analysis_task WHERE profile_id=? AND lower(platform)=? " +
                            "AND task_key IS NOT NULL AND status IN ('PENDING','LEASED')",
                    Integer.class,
                    profileId,
                    normalizePlatform(platform)
            );
            return count == null ? 0 : count;
        }
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM job_analysis_task WHERE profile_id=? AND task_key IS NOT NULL " +
                        "AND status IN ('PENDING','LEASED')",
                Integer.class,
                profileId
        );
        return count == null ? 0 : count;
    }

    public int pendingCount(long profileId) {
        return pendingCount(profileId, null);
    }

    public int pendingCount(long profileId, String platform) {
        return statusCount(profileId, platform, Status.PENDING);
    }

    public int processingCount(long profileId) {
        return processingCount(profileId, null);
    }

    public int processingCount(long profileId, String platform) {
        return statusCount(profileId, platform, Status.LEASED);
    }

    private int statusCount(long profileId, String platform, Status status) {
        if (platform != null && !platform.isBlank()) {
            Integer count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM job_analysis_task WHERE profile_id=? AND lower(platform)=? " +
                            "AND task_key IS NOT NULL AND status=?",
                    Integer.class,
                    profileId,
                    normalizePlatform(platform),
                    status.name()
            );
            return count == null ? 0 : count;
        }
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM job_analysis_task WHERE profile_id=? AND task_key IS NOT NULL AND status=?",
                Integer.class,
                profileId,
                status.name()
        );
        return count == null ? 0 : count;
    }

    public JobAiAnalysisService.JobAnalysisRequest deserialize(TaskRecord task) {
        if (task == null || task.requestJson() == null || task.requestJson().isBlank()) {
            throw new IllegalArgumentException("任务缺少可恢复的请求快照");
        }
        try {
            JobAiAnalysisService.JobAnalysisRequest request = objectMapper.readValue(
                    task.requestJson(), JobAiAnalysisService.JobAnalysisRequest.class);
            validateRequest(request);
            String platform = normalizePlatform(request.getPlatform());
            String jobKey = stableJobKey(request);
            if (!java.util.Objects.equals(task.profileId(), request.getProfileId())
                    || !java.util.Objects.equals(normalizePlatform(task.platform()), platform)
                    || !java.util.Objects.equals(task.jobKey(), jobKey)
                    || !java.util.Objects.equals(task.jobRowId(), request.getJobRowId())) {
                throw new IllegalStateException("AI 分析任务快照与任务索引不一致");
            }
            validateTargetJobIdentity(request, platform, jobKey);
            return request;
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("AI 分析任务请求快照损坏", e);
        }
    }

    TaskRecord findById(long id) {
        List<TaskRecord> rows = jdbcTemplate.query(
                "SELECT " + selectColumns() + " FROM job_analysis_task WHERE id=?",
                TASK_MAPPER,
                id
        );
        return rows.isEmpty() ? null : rows.get(0);
    }

    TaskRecord findByIdAndProfile(long id, long profileId) {
        List<TaskRecord> rows = jdbcTemplate.query(
                "SELECT " + selectColumns() + " FROM job_analysis_task WHERE id=? AND profile_id=?",
                TASK_MAPPER,
                id,
                profileId
        );
        return rows.isEmpty() ? null : rows.get(0);
    }

    private TaskRecord findByTaskKey(String taskKey) {
        List<TaskRecord> rows = jdbcTemplate.query(
                "SELECT " + selectColumns() + " FROM job_analysis_task WHERE task_key=?",
                TASK_MAPPER,
                taskKey
        );
        return rows.isEmpty() ? null : rows.get(0);
    }

    private TaskRecord findActive(Long profileId, String platform, String jobKey) {
        List<TaskRecord> rows = jdbcTemplate.query(
                "SELECT " + selectColumns() + " FROM job_analysis_task WHERE profile_id=? AND platform=? " +
                        "AND job_key=? AND task_key IS NOT NULL AND status IN ('PENDING','LEASED') ORDER BY id DESC LIMIT 1",
                TASK_MAPPER,
                profileId,
                platform,
                jobKey
        );
        return rows.isEmpty() ? null : rows.get(0);
    }

    private String taskKey(JobAiAnalysisService.JobAnalysisRequest request, String platform, String jobKey) {
        Map<String, Object> inputs = new LinkedHashMap<>();
        inputs.put("profileId", request.getProfileId());
        inputs.put("platform", platform);
        inputs.put("jobKey", jobKey);
        inputs.put("keyword", canonical(request.getKeyword()));
        inputs.put("companyName", canonical(request.getCompanyName()));
        inputs.put("jobName", canonical(request.getJobName()));
        inputs.put("salary", canonical(request.getSalary()));
        inputs.put("location", canonical(request.getLocation()));
        inputs.put("experience", canonical(request.getExperience()));
        inputs.put("degree", canonical(request.getDegree()));
        inputs.put("companyInfo", canonical(request.getCompanyInfo()));
        inputs.put("jobDescription", canonical(request.getJobDescription()));
        inputs.put("resumeFingerprint", currentResumeFingerprint(request.getProfileId()));
        try {
            String digest = sha256(objectMapper.writeValueAsString(inputs));
            return "ai:v2:" + request.getProfileId() + ":" + platform + ":" + digest;
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("无法生成 AI 分析任务摘要", e);
        }
    }

    private String currentResumeFingerprint(Long profileId) {
        List<String> rows = jdbcTemplate.query(
                "SELECT COALESCE(resume_text, '') FROM resume_profile WHERE profile_id=? " +
                        "ORDER BY updated_at DESC, id DESC LIMIT 1",
                (rs, rowNum) -> rs.getString(1),
                profileId
        );
        return sha256(rows.isEmpty() ? "" : rows.get(0));
    }

    private JobAiAnalysisService.JobAnalysisRequest analysisRequest(String platform,
                                                                    long rowId,
                                                                    long profileId,
                                                                    String jobKey,
                                                                    String keyword,
                                                                    String companyName,
                                                                    String jobName,
                                                                    String salary,
                                                                    String location,
                                                                    String experience,
                                                                    String degree,
                                                                    String companyInfo,
                                                                    String jobDescription,
                                                                    String scanRunId) {
        JobAiAnalysisService.JobAnalysisRequest request = new JobAiAnalysisService.JobAnalysisRequest();
        request.setProfileId(profileId);
        request.setPlatform(platform);
        request.setJobKey(jobKey);
        request.setJobRowId(rowId);
        request.setKeyword(keyword);
        request.setCompanyName(companyName);
        request.setJobName(jobName);
        request.setSalary(salary);
        request.setLocation(location);
        request.setExperience(experience);
        request.setDegree(degree);
        request.setCompanyInfo(companyInfo);
        request.setJobDescription(jobDescription);
        request.setScanRunId(scanRunId);
        return request;
    }

    private String serialize(JobAiAnalysisService.JobAnalysisRequest request) {
        try {
            return objectMapper.writeValueAsString(request);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("AI 分析请求无法持久化", e);
        }
    }

    private void validateRequest(JobAiAnalysisService.JobAnalysisRequest request) {
        if (request == null) throw new IllegalArgumentException("AI 分析任务不能为空");
        if (request.getProfileId() == null) throw new IllegalArgumentException("AI 分析任务缺少档案 ID");
        String platform = normalizePlatform(request.getPlatform());
        if (!SUPPORTED_PLATFORMS.contains(platform)) {
            throw new IllegalArgumentException("持久 AI 队列只支持 boss/zhilian");
        }
        if (stableJobKey(request).isBlank()) {
            throw new IllegalArgumentException("AI 分析任务缺少稳定岗位标识");
        }
        if (request.getJobRowId() == null || request.getJobRowId() <= 0) {
            throw new IllegalArgumentException("AI 分析任务缺少有效岗位行 ID");
        }
    }

    private void validateTargetJobIdentity(JobAiAnalysisService.JobAnalysisRequest request,
                                           String platform,
                                           String jobKey) {
        String table = "boss".equals(platform) ? "boss_data" : "zhilian_data";
        String stableIdColumn = "boss".equals(platform) ? "encrypt_id" : "job_id";
        String jobNameColumn = "boss".equals(platform) ? "job_name" : "job_title";
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT profile_id, " + stableIdColumn + " AS stable_id, company_name, "
                        + jobNameColumn + " AS job_name FROM " + table + " WHERE id=?",
                request.getJobRowId()
        );
        String storedKey = "";
        Long storedProfileId = null;
        if (rows.size() == 1) {
            Map<String, Object> row = rows.get(0);
            storedProfileId = nullableLong(row.get("profile_id"));
            storedKey = firstNonBlank((String) row.get("stable_id"));
            if (storedKey.isBlank()) {
                String company = canonical((String) row.get("company_name"));
                String jobName = canonical((String) row.get("job_name"));
                storedKey = company.isBlank() && jobName.isBlank() ? "" : company + "::" + jobName;
            }
        }
        if (rows.size() != 1
                || !java.util.Objects.equals(storedProfileId, request.getProfileId())
                || !java.util.Objects.equals(storedKey, jobKey)) {
            throw new IllegalArgumentException(
                    "AI 分析任务与目标岗位不一致：profileId=" + request.getProfileId()
                            + ", platform=" + platform
                            + ", jobRowId=" + request.getJobRowId()
                            + ", jobKey=" + jobKey
            );
        }
    }

    private String normalizePlatform(String platform) {
        return platform == null ? "" : platform.trim().toLowerCase(Locale.ROOT);
    }

    private String stableJobKey(JobAiAnalysisService.JobAnalysisRequest request) {
        String direct = firstNonBlank(request.getJobKey());
        if (!direct.isBlank()) return direct;
        String company = canonical(request.getCompanyName());
        String jobName = canonical(request.getJobName());
        return company.isBlank() && jobName.isBlank() ? "" : company + "::" + jobName;
    }

    private String canonical(String value) {
        return value == null ? "" : value.trim().replace("\r\n", "\n").replace('\r', '\n');
    }

    private static String dbTime(LocalDateTime value) {
        return value == null ? null : DB_TIME.format(value);
    }

    private static LocalDateTime parseDbTime(String value) {
        if (value == null || value.isBlank()) return null;
        for (DateTimeFormatter formatter : List.of(DB_TIME, DateTimeFormatter.ISO_LOCAL_DATE_TIME)) {
            try {
                return LocalDateTime.parse(value.trim(), formatter);
            } catch (DateTimeParseException ignored) {
                // 兼容升级前 SQLite CURRENT_TIMESTAMP 的秒级格式。
            }
        }
        try {
            return LocalDateTime.parse(value.trim(), DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        } catch (DateTimeParseException ignored) {
            return null;
        }
    }

    private static LocalDateTime min(LocalDateTime first, LocalDateTime second) {
        return first.isBefore(second) ? first : second;
    }

    private String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("当前运行时不支持 SHA-256", e);
        }
    }

    private String duplicateMessage(TaskRecord task) {
        return switch (task.statusEnum()) {
            case PENDING, LEASED -> "重复 AI 分析任务，已复用现有任务";
            case SUCCEEDED -> "相同岗位输入已经完成 AI 分析";
            case FAILED -> "相同岗位输入上次分析失败，需要显式重试";
            case UNKNOWN -> "相同岗位输入结果未知，需要先人工确认再显式重试";
        };
    }

    private String selectColumns() {
        return "id, profile_id, platform, job_key, job_row_id, scan_run_id, status, attempt_count, " +
                "request_json, lease_owner, lease_expires_at, last_error, created_at, updated_at, started_at, completed_at";
    }

    private static Long nullableLong(Object value) {
        return value == null ? null : ((Number) value).longValue();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String firstNonBlank(String... values) {
        if (values == null) return "";
        for (String value : values) {
            if (value != null && !value.isBlank()) return value.trim();
        }
        return "";
    }

    public enum Status {
        PENDING,
        LEASED,
        SUCCEEDED,
        FAILED,
        UNKNOWN
    }

    public record TaskRecord(
            long id,
            Long profileId,
            String platform,
            String jobKey,
            Long jobRowId,
            String scanRunId,
            String status,
            int attemptCount,
            @JsonIgnore String requestJson,
            @JsonIgnore String leaseOwner,
            String leaseExpiresAt,
            String lastError,
            String createdAt,
            String updatedAt,
            String startedAt,
            String completedAt
    ) {
        public Status statusEnum() {
            return Status.valueOf(status);
        }

        public TaskView toView() {
            return new TaskView(id, profileId, platform, jobKey, jobRowId, scanRunId, status,
                    attemptCount, leaseExpiresAt, lastError, createdAt, updatedAt, startedAt, completedAt);
        }
    }

    public record TaskView(
            long id,
            Long profileId,
            String platform,
            String jobKey,
            Long jobRowId,
            String scanRunId,
            String status,
            int attemptCount,
            String leaseExpiresAt,
            String lastError,
            String createdAt,
            String updatedAt,
            String startedAt,
            String completedAt
    ) {
    }

    public record SubmitResult(boolean accepted, boolean created, TaskRecord task, String message) {
        static SubmitResult created(TaskRecord task) {
            return new SubmitResult(true, true, task, "AI 分析任务已持久化");
        }

        static SubmitResult existing(TaskRecord task, String message) {
            return new SubmitResult(true, false, task, message);
        }

        static SubmitResult rejected(String message) {
            return new SubmitResult(false, false, null, message);
        }
    }

    public record RetryResult(boolean accepted, TaskRecord task, String message) {
        static RetryResult accepted(TaskRecord task) {
            return new RetryResult(true, task, "AI 分析任务已重新进入等待队列");
        }

        static RetryResult rejected(String message) {
            return new RetryResult(false, null, message);
        }
    }
}
