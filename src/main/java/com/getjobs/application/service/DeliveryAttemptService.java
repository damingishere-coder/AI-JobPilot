package com.getjobs.application.service;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * 投递动作的唯一事实源。平台表中的旧字段只作为兼容读模型，由本服务在同一事务内更新。
 */
@Service
@RequiredArgsConstructor
@DependsOn("databaseSchemaService")
public class DeliveryAttemptService {
    public static final String PLATFORM_STATUS_TEXT = "PLATFORM_STATUS_TEXT";
    public static final String PLATFORM_SUCCESS_DIALOG = "PLATFORM_SUCCESS_DIALOG";
    public static final String EXISTING_CONVERSATION = "EXISTING_CONVERSATION";
    public static final String CHAT_SURFACE_ONLY = "CHAT_SURFACE_ONLY";
    public static final String NO_CONFIRMATION = "NO_CONFIRMATION";
    public static final String PLATFORM_ERROR = "PLATFORM_ERROR";
    public static final String PRE_ACTION_ERROR = "PRE_ACTION_ERROR";
    public static final String MANUAL_RECONCILIATION = "MANUAL_RECONCILIATION";
    public static final String RETRY_APPROVED = "RETRY_APPROVED";

    private static final Set<String> PLATFORMS = Set.of("boss", "zhilian", "liepin", "51job");
    private static final Set<String> CONFIRMATION_EVIDENCE = Set.of(
            PLATFORM_STATUS_TEXT,
            PLATFORM_SUCCESS_DIALOG,
            EXISTING_CONVERSATION
    );

    private final JdbcTemplate jdbcTemplate;
    private final PlatformTransactionManager transactionManager;

    @PostConstruct
    public void validateSchema() {
        Integer tableCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='delivery_attempt'",
                Integer.class
        );
        Integer requestKeyColumn = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pragma_table_info('delivery_attempt') WHERE name='request_key'",
                Integer.class
        );
        Integer jobIndex = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_delivery_attempt_job'",
                Integer.class
        );
        Integer stateIndex = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_delivery_attempt_state_updated'",
                Integer.class
        );
        if (tableCount == null || tableCount != 1
                || requestKeyColumn == null || requestKeyColumn != 1
                || jobIndex == null || jobIndex != 1
                || stateIndex == null || stateIndex != 1) {
            throw new IllegalStateException("投递 attempt schema 不完整，已阻止应用继续启动");
        }
    }

    public RequestResult requestBoss(long rowId, long profileId, String jobKey, boolean allowAiNotMatch) {
        return request("boss", profileId, rowId, jobKey, () -> {
            if (allowAiNotMatch) {
                return jdbcTemplate.update("UPDATE boss_data SET delivery_status=?, failure_type='', failure_reason='', " +
                                "updated_at=CURRENT_TIMESTAMP WHERE id=? AND profile_id=? " +
                                "AND TRIM(COALESCE(delivery_status, '')) IN (?, ?)",
                        DeliveryStatus.DELIVERY_REQUESTED, rowId, profileId,
                        DeliveryStatus.WAITING_CONFIRM, DeliveryStatus.AI_NOT_MATCH);
            }
            return jdbcTemplate.update("UPDATE boss_data SET delivery_status=?, failure_type='', failure_reason='', " +
                            "updated_at=CURRENT_TIMESTAMP WHERE id=? AND profile_id=? " +
                            "AND TRIM(COALESCE(delivery_status, ''))=?",
                    DeliveryStatus.DELIVERY_REQUESTED, rowId, profileId, DeliveryStatus.WAITING_CONFIRM);
        });
    }

    public RequestResult requestZhilian(long rowId, long profileId, String jobKey) {
        return request("zhilian", profileId, rowId, jobKey, () -> jdbcTemplate.update(
                "UPDATE zhilian_data SET delivery_status=?, failure_type='', failure_reason='', " +
                        "update_time=CURRENT_TIMESTAMP WHERE id=? AND profile_id=? " +
                        "AND TRIM(COALESCE(delivery_status, ''))=?",
                DeliveryStatus.DELIVERY_REQUESTED, rowId, profileId, DeliveryStatus.WAITING_CONFIRM));
    }

    public RequestResult requestLegacy(String platform, long jobId) {
        String normalizedPlatform = normalizePlatform(platform);
        if (!Set.of("liepin", "51job").contains(normalizedPlatform)) {
            return RequestResult.rejected("旧平台投递只支持 liepin/51job");
        }
        long profileId = currentProfileId();
        String table = "liepin".equals(normalizedPlatform) ? "liepin_data" : "job51_data";
        LegacyJobRow row = findLegacyJob(table, profileId, jobId);
        if (row == null) {
            return RequestResult.rejected("当前档案中不存在该岗位，已拒绝创建投递任务");
        }
        return request(normalizedPlatform, profileId, row.id(), String.valueOf(jobId), () -> jdbcTemplate.update(
                "UPDATE " + table + " SET delivery_status=?, delivered=0, update_time=CURRENT_TIMESTAMP " +
                        "WHERE id=? AND profile_id=? AND job_id=? " +
                        "AND TRIM(COALESCE(delivery_status, '未投递'))=?",
                DeliveryStatus.DELIVERY_REQUESTED, row.id(), profileId, jobId, DeliveryStatus.NOT_DELIVERED));
    }

    public RequestResult retryBoss(long rowId, long profileId, String jobKey) {
        return retry("boss", profileId, rowId, jobKey, previous -> jdbcTemplate.update(
                "UPDATE boss_data SET delivery_status=?, failure_type='', failure_reason='', updated_at=CURRENT_TIMESTAMP " +
                        "WHERE id=? AND profile_id=? AND delivery_status=?",
                DeliveryStatus.DELIVERY_REQUESTED, rowId, profileId, displayStatus(previous)));
    }

    public RequestResult retryZhilian(long rowId, long profileId, String jobKey) {
        return retry("zhilian", profileId, rowId, jobKey, previous -> jdbcTemplate.update(
                "UPDATE zhilian_data SET delivery_status=?, failure_type='', failure_reason='', update_time=CURRENT_TIMESTAMP " +
                        "WHERE id=? AND profile_id=? AND delivery_status=?",
                DeliveryStatus.DELIVERY_REQUESTED, rowId, profileId, displayStatus(previous)));
    }

    public ResolutionResult reconcileLatest(String platform,
                                             Long profileId,
                                             long rowId,
                                             String jobKey,
                                             State target,
                                             String message) {
        String normalizedPlatform = normalizePlatform(platform);
        if (target != State.CONFIRMED && target != State.FAILED) {
            return ResolutionResult.rejected("人工对账只允许确认已投递或确认失败");
        }
        Attempt latest = findLatest(normalizedPlatform, profileId, rowId);
        if (latest == null || !sameJobKey(jobKey, latest.jobKey())) {
            return ResolutionResult.rejected("当前岗位没有可人工对账的 UNKNOWN 投递记录");
        }
        if (latest.stateEnum() == target) {
            return ResolutionResult.idempotent(target, "相同人工对账结果已保存");
        }
        if (latest.stateEnum() != State.UNKNOWN) {
            return ResolutionResult.rejected("当前岗位没有可人工对账的 UNKNOWN 投递记录");
        }
        return resolve(
                normalizedPlatform,
                profileId,
                rowId,
                latest.requestKey(),
                target,
                MANUAL_RECONCILIATION,
                firstNonBlank(message, target == State.CONFIRMED ? "人工核对平台后确认已投递" : "人工核对平台后确认失败"),
                target == State.FAILED ? "MANUAL_RECONCILIATION" : null,
                target == State.FAILED ? firstNonBlank(message, "人工核对平台后确认失败") : null,
                true
        );
    }

    public ResolutionResult resolve(String platform,
                                    Long profileId,
                                    long rowId,
                                    String requestKey,
                                    State target,
                                    String evidence,
                                    String message,
                                    String failureType,
                                    String failureReason) {
        return resolve(platform, profileId, rowId, requestKey, target, evidence, message,
                failureType, failureReason, false);
    }

    private ResolutionResult resolve(String platform,
                                     Long profileId,
                                     long rowId,
                                     String requestKey,
                                     State target,
                                     String evidence,
                                     String message,
                                     String failureType,
                                     String failureReason,
                                     boolean manualReconciliation) {
        String normalizedPlatform = normalizePlatform(platform);
        if (requestKey == null || requestKey.isBlank()) {
            return ResolutionResult.rejected("缺少 requestKey，拒绝无任务绑定的投递回调");
        }
        if (target == null || target == State.REQUESTED) {
            return ResolutionResult.rejected("投递结果状态无效");
        }
        String normalizedEvidence = normalizeEvidence(evidence);
        boolean validConfirmationEvidence = CONFIRMATION_EVIDENCE.contains(normalizedEvidence)
                || (manualReconciliation && MANUAL_RECONCILIATION.equals(normalizedEvidence));
        if (target == State.CONFIRMED && !validConfirmationEvidence) {
            return ResolutionResult.rejected("缺少明确平台成功证据，不能确认已投递");
        }

        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        return transaction.execute(status -> {
            Attempt attempt = findByRequestKey(requestKey);
            if (attempt == null
                    || !normalizedPlatform.equals(attempt.platform())
                    || !sameProfile(profileId, attempt.profileId())
                    || rowId != attempt.jobRowId()) {
                return ResolutionResult.rejected("requestKey 与平台、档案或岗位不匹配");
            }
            Attempt latest = findLatest(normalizedPlatform, profileId, rowId);
            if (latest == null || latest.id() != attempt.id()) {
                return ResolutionResult.rejected("该回调属于旧投递任务，已拒绝覆盖当前状态");
            }
            State current = State.valueOf(attempt.state());
            if (current == target) {
                return ResolutionResult.idempotent(target, "重复回调已幂等接受");
            }
            if (current == State.CONFIRMED || current == State.FAILED) {
                return ResolutionResult.rejected("投递终态不可被相反或延迟回调覆盖");
            }
            if (current != State.REQUESTED && current != State.UNKNOWN) {
                return ResolutionResult.rejected("当前投递状态不允许该转换");
            }

            int changed = jdbcTemplate.update("UPDATE delivery_attempt SET state=?, evidence=?, message=?, " +
                            "failure_type=?, failure_reason=?, resolved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP " +
                            "WHERE id=? AND state=?",
                    target.name(), normalizedEvidence, blankToNull(message),
                    target == State.FAILED ? normalizeFailureType(failureType) : null,
                    target == State.FAILED ? firstNonBlank(failureReason, message, DeliveryStatus.DELIVERY_FAILED) : null,
                    attempt.id(), current.name());
            if (changed != 1) {
                status.setRollbackOnly();
                return ResolutionResult.rejected("投递状态已被并发更新，请刷新后确认");
            }
            int mirrored = updateLegacyReadModel(
                    normalizedPlatform,
                    profileId,
                    rowId,
                    current,
                    target,
                    failureType,
                    failureReason,
                    message,
                    attempt.jobKey()
            );
            if (mirrored != 1) {
                status.setRollbackOnly();
                return ResolutionResult.rejected("岗位兼容状态写回失败，已回滚 attempt 更新");
            }
            return ResolutionResult.accepted(target, "投递结果已写入");
        });
    }

    public ResolutionResult resolveLegacy(String platform,
                                          long jobId,
                                          String requestKey,
                                          State target,
                                           String evidence,
                                           String message) {
        String normalizedPlatform = normalizePlatform(platform);
        Attempt attempt = requestKey == null || requestKey.isBlank() ? null : findByRequestKey(requestKey);
        long profileId = currentProfileId();
        if (attempt == null
                || !normalizedPlatform.equals(attempt.platform())
                || !sameProfile(profileId, attempt.profileId())
                || !sameJobKey(String.valueOf(jobId), attempt.jobKey())) {
            return ResolutionResult.rejected("requestKey 与当前档案或岗位不匹配");
        }
        return resolve(normalizedPlatform, profileId, attempt.jobRowId(), requestKey,
                target, evidence, message, null, null);
    }

    public ResolutionResult reconcileLatestLegacy(String platform,
                                                   long jobId,
                                                   State target,
                                                   String message) {
        String normalizedPlatform = normalizePlatform(platform);
        if (!Set.of("liepin", "51job").contains(normalizedPlatform)) {
            return ResolutionResult.rejected("旧平台对账只支持 liepin/51job");
        }
        long profileId = currentProfileId();
        String table = "liepin".equals(normalizedPlatform) ? "liepin_data" : "job51_data";
        LegacyJobRow row = findLegacyJob(table, profileId, jobId);
        if (row == null) {
            return ResolutionResult.rejected("当前档案中不存在该岗位");
        }
        return reconcileLatest(normalizedPlatform, profileId, row.id(), String.valueOf(jobId), target, message);
    }

    public RequestResult prepareLegacyRetry(String platform, long jobId) {
        String normalizedPlatform = normalizePlatform(platform);
        if (!Set.of("liepin", "51job").contains(normalizedPlatform)) {
            return RequestResult.rejected("旧平台重试只支持 liepin/51job");
        }
        long profileId = currentProfileId();
        String table = "liepin".equals(normalizedPlatform) ? "liepin_data" : "job51_data";
        LegacyJobRow row = findLegacyJob(table, profileId, jobId);
        if (row == null) {
            return RequestResult.rejected("当前档案中不存在该岗位");
        }
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        return transaction.execute(status -> {
            Attempt latest = findLatest(normalizedPlatform, profileId, row.id());
            if (latest == null || !sameJobKey(String.valueOf(jobId), latest.jobKey())) {
                return RequestResult.rejected("没有可重试的同岗位投递记录");
            }
            if (RETRY_APPROVED.equals(latest.evidence())) {
                return RequestResult.prepared("该岗位已经等待显式重试；下次启动平台任务时将创建新的 requestKey");
            }
            State previous = latest.stateEnum();
            if (previous != State.UNKNOWN && previous != State.FAILED) {
                return RequestResult.rejected("仅 UNKNOWN 或 FAILED 状态允许显式重试");
            }
            int jobChanged = jdbcTemplate.update("UPDATE " + table +
                            " SET delivery_status=?, delivered=0, update_time=CURRENT_TIMESTAMP " +
                            "WHERE id=? AND profile_id=? AND job_id=? AND delivery_status=?",
                    DeliveryStatus.NOT_DELIVERED, row.id(), profileId, jobId, displayStatus(previous));
            int attemptChanged = jdbcTemplate.update(
                    "UPDATE delivery_attempt SET evidence=?, message=?, updated_at=CURRENT_TIMESTAMP " +
                            "WHERE id=? AND state=?",
                    RETRY_APPROVED, "用户已确认显式重试，等待下次平台任务执行", latest.id(), previous.name());
            if (jobChanged != 1 || attemptChanged != 1) {
                status.setRollbackOnly();
                return RequestResult.rejected("岗位状态已变化，未准备重试");
            }
            return RequestResult.prepared("岗位已进入显式重试队列；下次启动该平台任务时才会创建新的 requestKey 并执行");
        });
    }

    /**
     * 仅返回当前 Profile 的最近投递事实，供人工对账确认使用。
     */
    public List<AttemptView> listRecentForCurrentProfile(String platform, int limit) {
        String normalizedPlatform = normalizePlatform(platform);
        long profileId = currentProfileId();
        int safeLimit = Math.max(1, Math.min(limit, 100));
        return jdbcTemplate.query(
                "SELECT request_key, platform, profile_id, job_key, job_row_id, state, evidence, message, " +
                        "failure_type, failure_reason, requested_at, resolved_at, updated_at " +
                        "FROM delivery_attempt WHERE platform=? AND profile_id=? ORDER BY id DESC LIMIT ?",
                (resultSet, rowNum) -> new AttemptView(
                        resultSet.getString("request_key"),
                        resultSet.getString("platform"),
                        resultSet.getLong("profile_id"),
                        resultSet.getString("job_key"),
                        resultSet.getLong("job_row_id"),
                        resultSet.getString("state"),
                        resultSet.getString("evidence"),
                        resultSet.getString("message"),
                        resultSet.getString("failure_type"),
                        resultSet.getString("failure_reason"),
                        resultSet.getString("requested_at"),
                        resultSet.getString("resolved_at"),
                        resultSet.getString("updated_at")
                ),
                normalizedPlatform, profileId, safeLimit
        );
    }

    private RequestResult request(String platform,
                                  Long profileId,
                                  long rowId,
                                  String jobKey,
                                  LegacyRequestWriter writer) {
        String normalizedPlatform = normalizePlatform(platform);
        if (rowId <= 0 || jobKey == null || jobKey.isBlank()) {
            return RequestResult.rejected("投递岗位标识无效");
        }
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        return transaction.execute(status -> {
            Attempt latest = findLatest(normalizedPlatform, profileId, rowId);
            if (latest != null) {
                if (!sameJobKey(jobKey, latest.jobKey())) {
                    return RequestResult.rejected("岗位行号与历史投递记录不一致，已阻止错误绑定");
                }
                State latestState = State.valueOf(latest.state());
                if (latestState == State.REQUESTED) {
                    return RequestResult.existing(latest.requestKey(), latestState, "投递请求已存在，请勿重复执行");
                }
                if (!RETRY_APPROVED.equals(latest.evidence())) {
                    return RequestResult.rejected("该岗位已有 " + latestState + " 投递记录，需先人工对账或显式重试");
                }
            }

            int reserved = writer.markRequested();
            if (reserved != 1) {
                return RequestResult.rejected("岗位状态已变化，未创建重复投递任务");
            }
            String requestKey = UUID.randomUUID().toString();
            insertRequestedAttempt(requestKey, normalizedPlatform, profileId, rowId, jobKey);
            return RequestResult.created(requestKey);
        });
    }

    private RequestResult retry(String platform,
                                Long profileId,
                                long rowId,
                                String jobKey,
                                LegacyRetryWriter writer) {
        String normalizedPlatform = normalizePlatform(platform);
        if (rowId <= 0 || jobKey == null || jobKey.isBlank()) {
            return RequestResult.rejected("投递岗位标识无效");
        }
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        return transaction.execute(status -> {
            Attempt latest = findLatest(normalizedPlatform, profileId, rowId);
            if (latest == null || !sameJobKey(jobKey, latest.jobKey())) {
                return RequestResult.rejected("没有可重试的同岗位投递记录");
            }
            State previous = latest.stateEnum();
            if (previous == State.REQUESTED) {
                return RequestResult.existing(latest.requestKey(), previous, "重试任务已存在，请恢复原任务");
            }
            if (previous != State.UNKNOWN && previous != State.FAILED) {
                return RequestResult.rejected("仅 UNKNOWN 或 FAILED 状态允许显式重试");
            }
            if (writer.markRequested(previous) != 1) {
                return RequestResult.rejected("岗位状态已变化，未创建重试任务");
            }
            String requestKey = UUID.randomUUID().toString();
            insertRequestedAttempt(requestKey, normalizedPlatform, profileId, rowId, jobKey);
            return RequestResult.created(requestKey);
        });
    }

    private void insertRequestedAttempt(String requestKey,
                                        String platform,
                                        Long profileId,
                                        long rowId,
                                        String jobKey) {
        LocalDateTime now = LocalDateTime.now();
        jdbcTemplate.update("INSERT INTO delivery_attempt " +
                        "(request_key, platform, profile_id, job_key, job_row_id, state, evidence, message, requested_at, updated_at) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                requestKey, platform, profileId, jobKey.trim(), rowId,
                State.REQUESTED.name(), "USER_CONFIRMED", "已创建投递请求", now, now);
    }

    private int updateLegacyReadModel(String platform,
                                      Long profileId,
                                      long rowId,
                                      State current,
                                      State target,
                                      String failureType,
                                      String failureReason,
                                      String message,
                                      String jobKey) {
        String displayStatus = switch (target) {
            case CONFIRMED -> DeliveryStatus.DELIVERED;
            case FAILED -> DeliveryStatus.DELIVERY_FAILED;
            case UNKNOWN -> DeliveryStatus.DELIVERY_UNKNOWN;
            case REQUESTED -> DeliveryStatus.DELIVERY_REQUESTED;
        };
        String expectedStatus = switch (current) {
            case REQUESTED -> DeliveryStatus.DELIVERY_REQUESTED;
            case UNKNOWN -> DeliveryStatus.DELIVERY_UNKNOWN;
            case CONFIRMED -> DeliveryStatus.DELIVERED;
            case FAILED -> DeliveryStatus.DELIVERY_FAILED;
        };
        if ("boss".equals(platform)) {
            return jdbcTemplate.update("UPDATE boss_data SET delivery_status=?, failure_type=?, failure_reason=?, " +
                            "updated_at=CURRENT_TIMESTAMP WHERE id=? AND profile_id=? AND delivery_status=? " +
                            "AND COALESCE(NULLIF(encrypt_id, ''), CAST(id AS TEXT))=?",
                    displayStatus,
                    target == State.FAILED ? normalizeFailureType(failureType) : "",
                    target == State.FAILED ? firstNonBlank(failureReason, message, DeliveryStatus.DELIVERY_FAILED) : "",
                    rowId, profileId, expectedStatus, jobKey);
        }
        if ("zhilian".equals(platform)) {
            return jdbcTemplate.update("UPDATE zhilian_data SET delivery_status=?, failure_type=?, failure_reason=?, " +
                            "update_time=CURRENT_TIMESTAMP WHERE id=? AND profile_id=? AND delivery_status=? " +
                            "AND COALESCE(NULLIF(job_id, ''), CAST(id AS TEXT))=?",
                    displayStatus,
                    target == State.FAILED ? normalizeFailureType(failureType) : "",
                    target == State.FAILED ? firstNonBlank(failureReason, message, DeliveryStatus.DELIVERY_FAILED) : "",
                    rowId, profileId, expectedStatus, jobKey);
        }
        String table = "liepin".equals(platform) ? "liepin_data" : "job51_data";
        return jdbcTemplate.update("UPDATE " + table + " SET delivery_status=?, delivered=?, update_time=CURRENT_TIMESTAMP " +
                        "WHERE id=? AND profile_id=? AND job_id=? AND delivery_status=?",
                displayStatus, target == State.CONFIRMED ? 1 : 0,
                rowId, profileId, Long.parseLong(jobKey), expectedStatus);
    }

    private Attempt findByRequestKey(String requestKey) {
        List<Attempt> attempts = jdbcTemplate.query(
                "SELECT id, request_key, platform, profile_id, job_key, job_row_id, state, evidence " +
                        "FROM delivery_attempt WHERE request_key=?",
                (resultSet, rowNum) -> new Attempt(
                        resultSet.getLong("id"),
                        resultSet.getString("request_key"),
                        resultSet.getString("platform"),
                        nullableLong(resultSet, "profile_id"),
                        resultSet.getString("job_key"),
                        resultSet.getLong("job_row_id"),
                        resultSet.getString("state"),
                        resultSet.getString("evidence")
                ),
                requestKey.trim()
        );
        return attempts.isEmpty() ? null : attempts.getFirst();
    }

    private Attempt findLatest(String platform, Long profileId, long rowId) {
        String profilePredicate = profileId == null ? "profile_id IS NULL" : "profile_id=?";
        String sql = "SELECT id, request_key, platform, profile_id, job_key, job_row_id, state, evidence " +
                "FROM delivery_attempt WHERE platform=? AND job_row_id=? AND " + profilePredicate +
                " ORDER BY id DESC LIMIT 1";
        Object[] args = profileId == null
                ? new Object[]{platform, rowId}
                : new Object[]{platform, rowId, profileId};
        List<Attempt> attempts = jdbcTemplate.query(
                sql,
                (resultSet, rowNum) -> new Attempt(
                        resultSet.getLong("id"),
                        resultSet.getString("request_key"),
                        resultSet.getString("platform"),
                        nullableLong(resultSet, "profile_id"),
                        resultSet.getString("job_key"),
                        resultSet.getLong("job_row_id"),
                        resultSet.getString("state"),
                        resultSet.getString("evidence")
                ),
                args
        );
        return attempts.isEmpty() ? null : attempts.getFirst();
    }

    private Long nullableLong(java.sql.ResultSet resultSet, String column) throws java.sql.SQLException {
        long value = resultSet.getLong(column);
        return resultSet.wasNull() ? null : value;
    }

    private long currentProfileId() {
        List<Long> active = jdbcTemplate.query(
                "SELECT id FROM profile WHERE is_active=1 ORDER BY id LIMIT 1",
                (resultSet, rowNum) -> resultSet.getLong(1));
        if (!active.isEmpty()) return active.getFirst();
        List<Long> first = jdbcTemplate.query(
                "SELECT id FROM profile ORDER BY id LIMIT 1",
                (resultSet, rowNum) -> resultSet.getLong(1));
        if (first.isEmpty()) {
            throw new IllegalStateException("请先创建候选人档案");
        }
        return first.getFirst();
    }

    private LegacyJobRow findLegacyJob(String table, long profileId, long jobId) {
        List<LegacyJobRow> rows = jdbcTemplate.query(
                "SELECT id, profile_id, job_id FROM " + table +
                        " WHERE profile_id=? AND job_id=? ORDER BY id LIMIT 2",
                (resultSet, rowNum) -> new LegacyJobRow(
                        resultSet.getLong("id"),
                        resultSet.getLong("profile_id"),
                        resultSet.getLong("job_id")),
                profileId, jobId);
        if (rows.size() > 1) {
            throw new IllegalStateException(table + " 中同一档案存在重复 job_id，已阻止投递");
        }
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private String normalizePlatform(String platform) {
        String normalized = platform == null ? "" : platform.trim().toLowerCase(Locale.ROOT);
        if (!PLATFORMS.contains(normalized)) {
            throw new IllegalArgumentException("不支持的投递平台: " + platform);
        }
        return normalized;
    }

    private String normalizeEvidence(String evidence) {
        return evidence == null ? "" : evidence.trim().toUpperCase(Locale.ROOT);
    }

    private String normalizeFailureType(String failureType) {
        return firstNonBlank(failureType, DeliveryStatus.UNKNOWN_FAILURE_TYPE).trim();
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private String firstNonBlank(String... values) {
        if (values != null) {
            for (String value : values) {
                if (value != null && !value.isBlank()) return value.trim();
            }
        }
        return "";
    }

    private boolean sameProfile(Long expected, Long actual) {
        return expected == null ? actual == null : expected.equals(actual);
    }

    private boolean sameJobKey(String expected, String actual) {
        return expected != null && actual != null && expected.trim().equals(actual.trim());
    }

    private String displayStatus(State state) {
        return switch (state) {
            case REQUESTED -> DeliveryStatus.DELIVERY_REQUESTED;
            case CONFIRMED -> DeliveryStatus.DELIVERED;
            case FAILED -> DeliveryStatus.DELIVERY_FAILED;
            case UNKNOWN -> DeliveryStatus.DELIVERY_UNKNOWN;
        };
    }

    public enum State {
        REQUESTED,
        CONFIRMED,
        FAILED,
        UNKNOWN;

        public static State parse(String value) {
            if (value == null || value.isBlank()) return null;
            try {
                return valueOf(value.trim().toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException ignored) {
                return null;
            }
        }
    }

    public record RequestResult(boolean accepted,
                                boolean created,
                                String requestKey,
                                State state,
                                String message) {
        static RequestResult created(String requestKey) {
            return new RequestResult(true, true, requestKey, State.REQUESTED, "投递请求已创建");
        }

        static RequestResult existing(String requestKey, State state, String message) {
            return new RequestResult(true, false, requestKey, state, message);
        }

        static RequestResult prepared(String message) {
            return new RequestResult(true, false, null, null, message);
        }

        static RequestResult rejected(String message) {
            return new RequestResult(false, false, null, null, message);
        }
    }

    private record LegacyJobRow(long id, long profileId, long jobId) {
    }

    public record ResolutionResult(boolean accepted,
                                   boolean idempotent,
                                   State state,
                                   String message) {
        static ResolutionResult accepted(State state, String message) {
            return new ResolutionResult(true, false, state, message);
        }

        static ResolutionResult idempotent(State state, String message) {
            return new ResolutionResult(true, true, state, message);
        }

        static ResolutionResult rejected(String message) {
            return new ResolutionResult(false, false, null, message);
        }
    }

    public record AttemptView(String requestKey,
                              String platform,
                              long profileId,
                              String jobKey,
                              long jobRowId,
                              String state,
                              String evidence,
                              String message,
                              String failureType,
                              String failureReason,
                              String requestedAt,
                              String resolvedAt,
                              String updatedAt) {
    }

    private record Attempt(long id,
                           String requestKey,
                           String platform,
                           Long profileId,
                           String jobKey,
                           long jobRowId,
                           String state,
                           String evidence) {
        State stateEnum() {
            return State.valueOf(state);
        }
    }

    @FunctionalInterface
    private interface LegacyRequestWriter {
        int markRequested();
    }

    @FunctionalInterface
    private interface LegacyRetryWriter {
        int markRequested(State previous);
    }
}
