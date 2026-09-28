package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.*;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

/** Durable authorization and original context, isolated by profile and encrypted at rest. */
@Service
@RequiredArgsConstructor
public class HrAutopilotStore {
    public static final String PROTOCOL = "2026-09-28-hr-review-identity";
    public static final String BOSS_RESUME = "BOSS_NATIVE";
    public static final String RULES = "基于当前档案中已确认的简历与沟通资料回答，可主动询问岗位职责、地点和待遇；不编造、不自动拒绝。具体预约、薪资让步、接受Offer/合同、付费、证件银行卡、微信和其他材料、未知或矛盾事实、读取不完整必须人工决定。电话和指定简历分别授权，且仅对方明确索要时提供。按确认的历史范围处理待回复会话。";
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final HrAssistantCryptoService crypto;
    private final HrAssistantStore hr;

    public record Policy(int version, boolean enabled, boolean paused, String resumeName,
                         String resumeSha256, String facts, String rules, String pendingFact,
                         String replyMode, boolean sharePhone, boolean shareResume, String historyMode, int historyDays) {
        public Policy {
            replyMode = replyMode == null ? "REVIEW" : replyMode;
            historyMode = historyMode == null ? "NEW_ONLY" : historyMode;
            historyDays = historyDays == 0 ? 30 : historyDays;
        }
        public static Policy defaults() { return new Policy(1, false, false, "", "", "", RULES, "", "REVIEW", false, false, "NEW_ONLY", 30); }
    }
    public Policy policy(Long profileId) {
        var rows = jdbc.query("SELECT version,enabled,paused,policy_cipher FROM hr_autopilot_policy WHERE profile_id=?", (rs,n) -> {
            Policy p = decode(rs.getString("policy_cipher"), "autopilot:" + profileId, Policy.class);
            return new Policy(rs.getInt("version"), rs.getBoolean("enabled"), rs.getBoolean("paused"), p.resumeName(), p.resumeSha256(), p.facts(), RULES, p.pendingFact(), p.replyMode(), p.sharePhone(), p.shareResume(), p.historyMode(), p.historyDays());
        }, profileId);
        return rows.isEmpty() ? Policy.defaults() : rows.getFirst();
    }
    @Transactional
    public Policy configure(Long profileId, int expectedVersion, boolean enabled, String resumeName, String resumeSha256) {
        return configure(profileId, expectedVersion, enabled, resumeName, resumeSha256, "AUTO", true, true, "NEW_ONLY", 30);
    }
    @Transactional
    public Policy configure(Long profileId, int expectedVersion, boolean enabled, String resumeName, String resumeSha256,
                            String replyMode, boolean sharePhone, boolean shareResume, String historyMode, int historyDays) {
        Policy old = policy(profileId);
        if (old.version() != expectedVersion) throw new HrAssistantStore.StaleProposalException("托管规则已变化，请重新加载");
        var settings = hr.loadSettingsSecret(profileId);
        if (!Set.of("AUTO", "REVIEW").contains(Objects.toString(replyMode,"")) || !Set.of("RECENT", "NEW_ONLY").contains(Objects.toString(historyMode,"")) || historyDays < 1 || historyDays > 30)
            throw new IllegalArgumentException("回复模式或历史范围无效（最多30天）");
        if (enabled && replyMode.equals("AUTO") && (!settings.qqEnabled() || settings.qqTargetType() != QqTargetType.GROUP || settings.qqOperator().isBlank()))
            throw new IllegalArgumentException("请先配置 QQ 群和唯一操作人 QQ");
        String name = Objects.toString(resumeName, "").trim();
        String hash = Objects.toString(resumeSha256, "").trim().toLowerCase(Locale.ROOT);
        if (enabled && shareResume && !BOSS_RESUME.equals(name) && (!name.toLowerCase(Locale.ROOT).endsWith(".pdf") || !hash.matches("[a-f0-9]{64}")))
            throw new IllegalArgumentException("请先选择并确认允许发送的简历文件");
        if (enabled && shareResume && BOSS_RESUME.equals(name) && "AUTO".equals(replyMode))
            throw new IllegalArgumentException("BOSS 发简历按钮目前仅支持逐条确认后执行");
        Policy next = new Policy(old.version()+1, enabled, false, name, hash, old.facts(), RULES, "", replyMode, sharePhone, shareResume, historyMode, historyDays);
        save(profileId, next);
        jdbc.update("UPDATE hr_autopilot_policy SET settings_hash=?,contract_version=2 WHERE profile_id=?",settingsHash(profileId),profileId);
        jdbc.update("INSERT INTO hr_duty_progress(profile_id) VALUES (?) ON CONFLICT(profile_id) DO UPDATE SET baseline_complete=0,processed=0",profileId);
        // No previously approved automatic command may survive a policy change.
        jdbc.update("UPDATE hr_send_command SET status='STALE',outcome='STALE' WHERE profile_id=? AND status='PENDING' AND proposal_id IN (SELECT proposal_id FROM hr_autopilot_decision WHERE automatic=1)", profileId);
        return next;
    }
    private String settingsHash(Long profileId) {
        var s=hr.loadSettingsSecret(profileId);
        try { return crypto.blindIndex(json.writeValueAsString(List.of(s.communicationProfile(),s.qqEnabled(),s.qqTargetType(),s.qqTarget(),s.qqOperator(),jdbc.queryForList("SELECT COALESCE(resume_text,'') AS text FROM resume_profile WHERE profile_id=? ORDER BY updated_at DESC LIMIT 1",profileId))),"hr-policy-settings:"+profileId); }
        catch(Exception e) { throw new IllegalStateException("托管配置无法核验",e); }
    }
    public boolean authorizationValid(Long profileId) {
        var rows=jdbc.query("SELECT settings_hash FROM hr_autopilot_policy WHERE profile_id=? AND contract_version=2",(rs,n)->rs.getString(1),profileId);
        return !rows.isEmpty() && settingsHash(profileId).equals(rows.getFirst());
    }

    private void save(Long profileId, Policy p) {
        jdbc.update("""
            INSERT INTO hr_autopilot_policy(profile_id,version,enabled,paused,policy_cipher,enabled_at)
            VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(profile_id) DO UPDATE SET version=excluded.version,enabled=excluded.enabled,
             paused=excluded.paused,policy_cipher=excluded.policy_cipher,enabled_at=excluded.enabled_at,updated_at=CURRENT_TIMESTAMP
            """, profileId,p.version(),p.enabled(),p.paused(),encode(p,"autopilot:"+profileId));
    }
    @Transactional
    public Policy pause(Long profileId, boolean paused) {
        Policy p=policy(profileId);
        if (!p.enabled()) throw new IllegalStateException("请先在工作台核对规则并启用托管");
        Policy next=new Policy(p.version(),p.enabled(),paused,p.resumeName(),p.resumeSha256(),p.facts(),RULES,p.pendingFact(),p.replyMode(),p.sharePhone(),p.shareResume(),p.historyMode(),p.historyDays());
        save(profileId,next); return next;
    }
    @Transactional
    public Policy remember(Long profileId, String fact, boolean confirm) {
        Policy p=policy(profileId);
        String candidate=Objects.toString(fact, "").trim();
        if (confirm && (p.pendingFact().isBlank() || !candidate.equals(p.pendingFact())))
            throw new IllegalArgumentException("请先提交记住内容，再原文确认，避免保存错误事实");
        if (candidate.isBlank() || candidate.length()>1000 || p.facts().length()+candidate.length()>8000)
            throw new IllegalArgumentException("事实为空或过长，请在工作台整理资料");
        Policy next=new Policy(p.version()+1,p.enabled(),p.paused(),p.resumeName(),p.resumeSha256(),
                confirm ? p.facts()+"\n"+candidate : p.facts(),RULES,confirm ? "" : candidate,p.replyMode(),p.sharePhone(),p.shareResume(),p.historyMode(),p.historyDays());
        save(profileId,next); return next;
    }
    public void context(long conversationId, ChatCapture capture) {
        jdbc.update("""
            INSERT INTO hr_autopilot_context(conversation_id,snapshot_cipher) VALUES (?,?)
            ON CONFLICT(conversation_id) DO UPDATE SET snapshot_cipher=excluded.snapshot_cipher,updated_at=CURRENT_TIMESTAMP
            """,conversationId,encode(capture,"hr-context:"+conversationId));
    }
    public ChatCapture context(Long profileId, long conversationId) {
        var rows=jdbc.query("SELECT a.snapshot_cipher FROM hr_autopilot_context a JOIN hr_conversation c ON c.id=a.conversation_id WHERE c.profile_id=? AND c.id=?",
                (rs,n)->decode(rs.getString(1),"hr-context:"+conversationId,ChatCapture.class),profileId,conversationId);
        if(rows.isEmpty()) throw new IllegalStateException("尚未采集完整上下文，请等待补漏，未展示内容不代表没有消息");
        return rows.getFirst();
    }
    public void supplement(Long profileId,long conversationId,String fact) {
        context(profileId,conversationId);
        if (fact==null || fact.isBlank() || fact.length()>2000 || facts(conversationId).length()+fact.length()>8000) throw new IllegalArgumentException("补充内容应为1–2000字");
        jdbc.update("UPDATE hr_autopilot_context SET facts_cipher=? WHERE conversation_id=?",encode(facts(conversationId)+"\n"+fact,"hr-facts:"+conversationId),conversationId);
    }
    public String facts(long conversationId) {
        var rows=jdbc.query("SELECT facts_cipher FROM hr_autopilot_context WHERE conversation_id=?",(rs,n)->rs.getString(1),conversationId);
        return rows.isEmpty() || rows.getFirst()==null ? "" : decode(rows.getFirst(),"hr-facts:"+conversationId,String.class);
    }
    public void decision(long proposalId,int policyVersion,String action,String reason,boolean automatic) {
        jdbc.update("INSERT INTO hr_autopilot_decision(proposal_id,policy_version,action_type,reason_cipher,automatic) VALUES (?,?,?,?,?) ON CONFLICT(proposal_id) DO UPDATE SET policy_version=excluded.policy_version,action_type=excluded.action_type,reason_cipher=excluded.reason_cipher,automatic=excluded.automatic",
                proposalId,policyVersion,action,encode(reason,"hr-decision:"+proposalId),automatic);
    }
    public String decisionReason(long proposalId) {
        var rows=jdbc.query("SELECT reason_cipher FROM hr_autopilot_decision WHERE proposal_id=?",
                (rs,n)->decode(rs.getString(1),"hr-decision:"+proposalId,String.class),proposalId);
        return rows.isEmpty()?"需要用户确认回复":rows.getFirst();
    }
    public void audit(long proposalId, String evidence, boolean historical) {
        jdbc.update("UPDATE hr_autopilot_decision SET evidence_cipher=?,capture_origin=? WHERE proposal_id=?",
                encode(evidence,"hr-evidence:"+proposalId),historical?"BACKLOG":"LIVE",proposalId);
    }
    public Map<String,Object> activity(Long profileId) {
        Map<String,Object> out=new LinkedHashMap<>(progressStatus(profileId));
        out.put("decisions",jdbc.query("SELECT d.proposal_id,d.reason_cipher,d.capture_origin FROM hr_autopilot_decision d JOIN hr_reply_proposal p ON p.id=d.proposal_id WHERE p.profile_id=? ORDER BY p.updated_at DESC LIMIT 200",
                (rs,n)->Map.of("proposalId",rs.getLong(1),"reason",decode(rs.getString(2),"hr-decision:"+rs.getLong(1),String.class),"origin",rs.getString(3)),profileId));
        return out;
    }
    public Map<String,Object> progressStatus(Long profileId) {
        Map<String,Object> out=new LinkedHashMap<>();
        Map<String,Integer> counts=new LinkedHashMap<>();
        jdbc.query("SELECT status,COUNT(*) FROM hr_reply_proposal WHERE profile_id=? GROUP BY status",rs->{counts.put(rs.getString(1),rs.getInt(2));},profileId);
        out.put("counts",counts);
        var progress=jdbc.queryForList("SELECT processed,baseline_complete,updated_at FROM hr_duty_progress WHERE profile_id=?",profileId);
        out.put("progress",progress.isEmpty()?Map.of("processed",0,"baseline_complete",0):progress.getFirst());
        return out;
    }
    public void progress(Long profileId, boolean complete) {
        jdbc.update("INSERT INTO hr_duty_progress(profile_id,processed,baseline_complete) VALUES (?,?,?) ON CONFLICT(profile_id) DO UPDATE SET processed=processed+?,baseline_complete=?,updated_at=CURRENT_TIMESTAMP",profileId,complete?0:1,complete,complete?0:1,complete);
    }
    public void scanStarted(Long profileId) {
        jdbc.update("INSERT INTO hr_duty_progress(profile_id) VALUES (?) ON CONFLICT(profile_id) DO UPDATE SET baseline_complete=0,updated_at=CURRENT_TIMESTAMP",profileId);
    }
    public record Decision(int policyVersion,String action,boolean automatic) { }
    public Decision decision(long proposalId) {
        var rows=jdbc.query("SELECT policy_version,action_type,automatic FROM hr_autopilot_decision WHERE proposal_id=?",
                (rs,n)->new Decision(rs.getInt(1),rs.getString(2),rs.getBoolean(3)),proposalId);
        return rows.isEmpty()?new Decision(0,"TEXT",false):rows.getFirst();
    }
    public boolean conversationHeld(long conversationId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM hr_reply_proposal WHERE conversation_id=? AND status IN ('SEND_UNKNOWN','BLOCKED')",Integer.class,conversationId)>0;
    }
    public String enqueue(Long profileId,String key,String payload) {
        String id=UUID.randomUUID().toString();
        jdbc.update("INSERT OR IGNORE INTO hr_qq_delivery(id,profile_id,dedupe_key,payload_cipher) VALUES (?,?,?,?)",id,profileId,key,encode(payload,"qq-delivery:"+id));
        return id;
    }
    public void markTrial(long proposalId) {
        jdbc.update("UPDATE hr_autopilot_decision SET capture_origin='TRIAL' WHERE proposal_id=?", proposalId);
        jdbc.update("UPDATE hr_reply_proposal SET expires_at=datetime('now','localtime','+1 day') WHERE id=? AND status='REVIEW_REQUIRED'", proposalId);
    }
    public void notification(Long profileId,String key,String text) {
        var settings=hr.loadSettingsSecret(profileId);
        if(!settings.qqEnabled()) return;
        String targetKey=settings.qqTargetType()==QqTargetType.GROUP?"group_id":"user_id";
        String action=settings.qqTargetType()==QqTargetType.GROUP?"send_group_msg":"send_private_msg";
        try {
            String payload=json.writeValueAsString(Map.of("action",action,"params",Map.of(targetKey,Long.parseLong(settings.qqTarget()),
                    "message",List.of(Map.of("type","text","data",Map.of("text",text))))));
            enqueue(profileId,key,payload);
        } catch(Exception e) { throw new IllegalStateException("人工处理提醒无法入队",e); }
    }
    public void queueUnreportedFaults(Long profileId) {
        var ids=jdbc.query("SELECT p.id FROM hr_reply_proposal p JOIN hr_autopilot_decision d ON d.proposal_id=p.id WHERE p.profile_id=? AND p.status IN ('SEND_UNKNOWN','BLOCKED') AND NOT EXISTS (SELECT 1 FROM hr_qq_delivery q WHERE q.dedupe_key='send-final:'||p.id||':'||p.status) LIMIT 20",(rs,n)->rs.getLong(1),profileId);
        for(long id:ids) {
            var p=hr.getProposalView(profileId,id);
            notification(profileId,"send-final:"+id+":"+p.status(),"【BOSS HR 发送需人工核验】\n"+p.companyName()+" / "+p.hrName()+"\n状态："+p.status()+"，不要自动重发。请在工作台查看记录。");
        }
    }

    public Map<String,Integer> deliveryCounts(Long profileId) {
        Map<String,Integer> result=new LinkedHashMap<>();
        jdbc.query("SELECT status,COUNT(*) FROM hr_qq_delivery WHERE profile_id=? GROUP BY status",rs->{result.put(rs.getString(1),rs.getInt(2));},profileId);
        return result;
    }
    public void purgeExpired() {
        jdbc.update("DELETE FROM hr_autopilot_context WHERE updated_at<datetime('now','-30 days')");
        jdbc.update("UPDATE hr_qq_delivery SET payload_cipher='' WHERE status IN ('CONFIRMED','FAILED') AND created_at<datetime('now','-30 days')");
    }

    public record Delivery(String id,Long profileId,String payload) { }
    public List<Delivery> pending(Long profileId) {
        return jdbc.query("SELECT id,profile_id,payload_cipher FROM hr_qq_delivery WHERE profile_id=? AND status='PENDING' ORDER BY created_at,rowid LIMIT 10",
                (rs,n)->new Delivery(rs.getString(1),rs.getLong(2),decode(rs.getString(3),"qq-delivery:"+rs.getString(1),String.class)),profileId);
    }
    public boolean dispatching(String id) { return jdbc.update("UPDATE hr_qq_delivery SET status='UNKNOWN',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'",id)==1; }
    public void receipt(String id,boolean success,String messageId) {
        jdbc.update("UPDATE hr_qq_delivery SET status=?,message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='UNKNOWN'",success?"CONFIRMED":"FAILED",messageId,id);
    }
    private String encode(Object value,String aad) {
        try { return crypto.encrypt(json.writeValueAsString(value),aad); } catch(Exception e) { throw new IllegalStateException("托管数据无法保存",e); }
    }
    private <T>T decode(String value,String aad,Class<T> type) {
        try { return json.readValue(crypto.decrypt(value,aad),type); } catch(Exception e) { throw new IllegalStateException("托管数据无法读取",e); }
    }
}
