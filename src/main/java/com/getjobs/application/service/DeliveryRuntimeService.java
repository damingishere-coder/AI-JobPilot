package com.getjobs.application.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Durable, non-replayable side-effect permits. Never resume an executor after restart. */
@Service
public class DeliveryRuntimeService {
    private final JdbcTemplate jdbc;
    private final DeliveryAttemptService attempts;
    private final TransactionTemplate tx;
    private final boolean bossEnabled;
    @Value("${application.runtime.zhilian-enabled:false}")
    private boolean zhilianEnabled;

    public DeliveryRuntimeService(JdbcTemplate jdbc, DeliveryAttemptService attempts,
            PlatformTransactionManager manager,
            @Value("${application.runtime.boss-enabled:false}") boolean bossEnabled) {
        this.jdbc = jdbc;
        this.attempts = attempts;
        this.tx = new TransactionTemplate(manager);
        this.bossEnabled = bossEnabled;
    }

    public boolean enabled(String platform) {
        return (bossEnabled && "boss".equals(platform)) || (zhilianEnabled && "zhilian".equals(platform));
    }

    public record Claim(String platform, long profileId, long id, String url, String greeting,
                        String runId, String runtimeSessionId, String correlationId) {}
    public record Begin(long profileId, String runtimeSessionId, long claimVersion,
                        String pageType, String blocker) {}
    public record Observation(long profileId, String runtimeSessionId, long claimVersion,
                              String pageType, String blocker, Integer beforeCount, Integer afterCount, String effect) {
        public Observation(long profileId,String owner,long claim,String page,String blocker,int before,int after) {
            this(profileId,owner,claim,page,blocker,before,after,"UNCONFIRMED");
        }
    }

    /** Diagnostic only: these client observations cannot advance the application outcome. */
    public Map<String, Object> observe(String key, Observation request) {
        if (request == null || !validId(request.runtimeSessionId()) || request.pageType() == null || request.blocker() == null
                || !Set.of("UNKNOWN","SEARCH","JOB_DETAIL","CHAT").contains(request.pageType())
                || !Set.of("NONE","LOADING","LOGIN_REQUIRED","VERIFICATION_REQUIRED","QUOTA_LIMIT","BLOCKING_DIALOG","JOB_UNAVAILABLE","ERROR").contains(request.blocker())
                || invalidCount(request.beforeCount()) || invalidCount(request.afterCount())) return refused();
        return tx.execute(status -> {
            String effect = request.effect()!=null && Set.of("ALREADY_APPLIED","ALREADY_CONTACTED","GREETING_SENT","APPLICATION_CONFIRMED").contains(request.effect()) ? request.effect() : "UNCONFIRMED";
            jdbc.update("INSERT INTO runtime_event(attempt_id,action_seq,action,phase,page_type,blocker,detector_version,before_count,after_count,evidence) " +
                    "SELECT a.id,(SELECT COALESCE(MAX(action_seq),0)+1 FROM runtime_event WHERE attempt_id=a.id)," +
                    "'VERIFY_APPLY','OBSERVED',?,?,a.platform||'-page-evidence/1',?,?,? FROM delivery_attempt a WHERE request_key=? " +
                    "AND runtime_session_id=? AND claim_version=? AND profile_id=? " +
                    "AND profile_id=(SELECT id FROM profile WHERE is_active=1 ORDER BY id LIMIT 1) " +
                    "AND NOT EXISTS(SELECT 1 FROM runtime_event WHERE attempt_id=a.id AND phase='OBSERVED')",
                    request.pageType(),request.blocker(),request.beforeCount(),request.afterCount(),effect,key,
                    request.runtimeSessionId(),request.claimVersion(),request.profileId());
            return Map.of("success",true);
        });
    }

    public Map<String, Object> claim(String key, Claim request) {
        if (request == null || request.platform() == null || !validId(request.runId()) || !validId(request.runtimeSessionId())
                || !validId(request.correlationId())) return refused();
        return tx.execute(status -> {
            if (!attempts.validateDispatch(key, request.platform(), request.profileId(), request.id(),
                    request.url(), request.greeting(), false)) return refused();
            if (paused(request.runId(), request.profileId())) return refused();
            String phase = jdbc.queryForObject("SELECT runtime_phase FROM delivery_attempt WHERE request_key=?", String.class, key);
            // Disabling the rollout never hands an already claimed attempt to the old executor.
            if (!enabled(request.platform())) {
                if (!Set.of("LEGACY", "NOT_STARTED").contains(phase)) return refused();
                // Old executor has no durable boundary. Never later mistake its interrupted attempt for unstarted work.
                jdbc.update("UPDATE delivery_attempt SET runtime_phase='LEGACY' WHERE request_key=?", key);
                return Map.of("success", true, "enabled", false);
            }
            int changed = jdbc.update("UPDATE delivery_attempt SET runtime_phase='CLAIMED', run_id=?, " +
                    "runtime_session_id=?, correlation_id=?, claim_version=claim_version+1 WHERE request_key=? " +
                    "AND runtime_phase='NOT_STARTED' AND state='REQUESTED'",
                    request.runId(), request.runtimeSessionId(), request.correlationId(), key);
            if (changed != 1) return refused();
            event(key, "PREPARE_APPLY", "CLAIMED", null, null);
            return Map.of("success", true, "enabled", true, "claimVersion", 1);
        });
    }

    public Map<String, Object> begin(String key, Begin request) {
        if (request == null || !validId(request.runtimeSessionId())
                || !"JOB_DETAIL".equals(request.pageType()) || !"NONE".equals(request.blocker())) return refused();
        return tx.execute(status -> {
            // Write first: SQLite serializes competing permits. A repeated request never grants twice.
            int changed = jdbc.update("UPDATE delivery_attempt SET runtime_phase='EFFECT_POSSIBLE' WHERE request_key=? " +
                    "AND runtime_phase='CLAIMED' AND state='REQUESTED' AND platform IN ('boss','zhilian') AND runtime_session_id=? " +
                    "AND claim_version=? AND profile_id=? AND profile_id=(SELECT id FROM profile WHERE is_active=1 ORDER BY id LIMIT 1) " +
                    "AND ((platform='boss' AND EXISTS(SELECT 1 FROM boss_data j WHERE j.id=delivery_attempt.job_row_id AND j.profile_id=delivery_attempt.profile_id AND j.encrypt_id=delivery_attempt.job_key)) " +
                    "OR (platform='zhilian' AND EXISTS(SELECT 1 FROM zhilian_data j WHERE j.id=delivery_attempt.job_row_id AND j.profile_id=delivery_attempt.profile_id AND j.job_id=delivery_attempt.job_key))) " +
                    "AND NOT EXISTS(SELECT 1 FROM runtime_event e JOIN delivery_attempt stopped ON stopped.id=e.attempt_id " +
                    "WHERE e.phase='RUN_PAUSED' AND stopped.run_id=delivery_attempt.run_id AND stopped.profile_id=delivery_attempt.profile_id) " +
                    "AND NOT EXISTS(SELECT 1 FROM delivery_attempt newer WHERE newer.platform=delivery_attempt.platform " +
                    "AND newer.profile_id=delivery_attempt.profile_id AND newer.job_row_id=delivery_attempt.job_row_id AND newer.id>delivery_attempt.id) " +
                    "AND ((platform='boss' AND ?=1) OR (platform='zhilian' AND ?=1))",
                    key, request.runtimeSessionId(), request.claimVersion(), request.profileId(), bossEnabled ? 1 : 0, zhilianEnabled ? 1 : 0);
            if (changed != 1) return refused();
            event(key, "START_APPLY", "EFFECT_POSSIBLE", request.pageType(), request.blocker());
            return Map.of("success", true, "permitted", true);
        });
    }

    public List<Map<String, Object>> timeline(String key) {
        return jdbc.queryForList("SELECT e.action_seq,e.action,e.phase,e.page_type,e.blocker,e.evidence,e.detector_version,e.before_count,e.after_count,e.observed_at " +
                "FROM runtime_event e JOIN delivery_attempt a ON a.id=e.attempt_id WHERE a.request_key=? " +
                "AND a.profile_id=(SELECT id FROM profile WHERE is_active=1 ORDER BY id LIMIT 1) ORDER BY e.action_seq", key);
    }

    public Map<String,Object> pause(String key) {
        return tx.execute(status -> {
            var rows = jdbc.queryForList("SELECT run_id,profile_id FROM delivery_attempt WHERE request_key=? AND platform IN ('boss','zhilian') " +
                    "AND runtime_phase<>'LEGACY' AND run_id IS NOT NULL AND profile_id=(SELECT id FROM profile WHERE is_active=1 ORDER BY id LIMIT 1)", key);
            if (rows.size()!=1) return refused();
            var row=rows.getFirst();
            if (!paused(row.get("run_id").toString(),((Number)row.get("profile_id")).longValue()))
                event(key,"RECOVER_PAGE","RUN_PAUSED",null,null);
            return Map.of("success",true,"message","本批已暂停；已开始的当前动作完成核对，不启动下一岗位");
        });
    }

    private boolean paused(String runId,long profileId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM runtime_event e JOIN delivery_attempt a ON a.id=e.attempt_id " +
                "WHERE a.run_id=? AND a.profile_id=? AND e.phase='RUN_PAUSED'",Integer.class,runId,profileId)>0;
    }

    /** Called inside the caller's SQLite write transaction, before deleting source jobs. */
    public static void requireClearAllowed(java.sql.Connection connection,String platform,long profileId) throws java.sql.SQLException {
        try (var statement=connection.prepareStatement("SELECT COUNT(*) FROM delivery_attempt WHERE platform=? AND profile_id=? " +
                "AND runtime_phase IN ('CLAIMED','EFFECT_POSSIBLE','SETTLED') AND state IN ('REQUESTED','UNKNOWN')")) {
            statement.setString(1,platform); statement.setLong(2,profileId);
            try (var rows=statement.executeQuery()) {
                if(rows.next() && rows.getLong(1)>0) throw new IllegalStateException("仍有已领取或结果未知的投递，请先对账，不能清空源岗位");
            }
        }
    }

    private void event(String key, String action, String phase, String pageType, String blocker) {
        jdbc.update("INSERT INTO runtime_event(attempt_id,action_seq,action,phase,page_type,blocker,detector_version) " +
                "SELECT a.id,(SELECT COALESCE(MAX(action_seq),0)+1 FROM runtime_event WHERE attempt_id=a.id),?,?,?,?,? " +
                "FROM delivery_attempt a WHERE request_key=?", action, phase, pageType, blocker, "application-runtime/1", key);
    }

    private static boolean validId(String value) { return value != null && value.matches("[A-Za-z0-9:_-]{1,120}"); }
    private static boolean invalidCount(Integer value) { return value != null && (value < 0 || value > 10000); }
    private static Map<String, Object> refused() {
        return Map.of("success", false, "errorCode", "RUNTIME_RECONCILIATION_REQUIRED",
                "message", "执行许可未确认或已使用；已停止投递，请在恢复列表只读核对");
    }
}
