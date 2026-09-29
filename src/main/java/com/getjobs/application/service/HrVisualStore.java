package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrVisualTypes.*;
import com.getjobs.application.hr.HrVisualTypes;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service
@RequiredArgsConstructor
@DependsOn("databaseSchemaService")
public class HrVisualStore {
    private final JdbcTemplate db;
    private final HrAssistantCryptoService crypto;
    private final ObjectMapper json;

    public boolean busy() {
        return count("SELECT COUNT(*) FROM hr_visual_run WHERE status IN ('RUNNING','STOPPING')") > 0;
    }
    public List<Run> runs(Long profile) {
        return db.query("SELECT * FROM hr_visual_run WHERE profile_id=? ORDER BY created_at DESC,rowid DESC", (r,n) ->
                new Run(r.getString("id"), r.getLong("profile_id"), r.getString("status"),
                        crypto.decrypt(r.getString("account_cipher"), "visual-account:"+r.getString("id")), r.getString("reason")), profile);
    }
    @Transactional
    public String create(Long profile, String account, List<Long> sourceIds, List<Long> conversations, List<Seed> seeds) {
        if (busy()) throw new IllegalStateException("已有视觉测试正在执行");
        String id=UUID.randomUUID().toString();
        db.update("INSERT INTO hr_visual_run(id,profile_id,protocol,status,account_cipher,open_reserved) VALUES (?,?,?,'RUNNING',?,0)",
                id,profile,HrVisualTypes.PROTOCOL,crypto.encrypt(account,"visual-account:"+id));
        for(int i=0;i<seeds.size();i++) {
            String target=UUID.randomUUID().toString();
            db.update("INSERT INTO hr_visual_target(id,run_id,conversation_id,source_proposal_id,seed_cipher) VALUES (?,?,?,?,?)",
                    target,id,conversations.get(i),sourceIds.get(i),encrypt(seeds.get(i),"visual-seed:"+target));
        }
        return id;
    }
    public boolean reserveOpen(String run) {return db.update("UPDATE hr_visual_run SET open_reserved=1 WHERE id=? AND open_reserved=0",run)==1;}
    public List<Target> targets(String run) {
        return db.query("SELECT * FROM hr_visual_target WHERE run_id=? ORDER BY rowid",(r,n)->new Target(r.getString("id"),run,
                r.getLong("conversation_id"),r.getObject("proposal_id")==null?null:r.getLong("proposal_id"),
                read(r.getString("seed_cipher"),"visual-seed:"+r.getString("id")),r.getString("status"),r.getString("reason")),run);
    }
    public Target owner(Long profile,long proposal) {
        var run=db.queryForList("SELECT t.run_id FROM hr_visual_target t JOIN hr_visual_run r ON r.id=t.run_id WHERE r.profile_id=? AND t.proposal_id=?",String.class,profile,proposal);
        if(run.isEmpty()) return null;
        return targets(run.getFirst()).stream().filter(t->Objects.equals(t.proposalId(),proposal)).findFirst().orElse(null);
    }
    public Run run(Long profile,String id) {
        return runs(profile).stream().filter(r->r.id().equals(id)).findFirst().orElseThrow(()->new IllegalArgumentException("视觉会话不存在或档案不匹配"));
    }
    public void state(String run,String status,String reason) {
        db.update("UPDATE hr_visual_run SET status=?,reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",status,reason,run);
    }
    public void target(String id,Long proposal,String status,String reason) {
        db.update("UPDATE hr_visual_target SET proposal_id=COALESCE(?,proposal_id),status=?,reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",proposal,status,reason,id);
    }
    public void seed(String id,Seed seed) { db.update("UPDATE hr_visual_target SET seed_cipher=? WHERE id=?",encrypt(seed,"visual-seed:"+id),id); }
    @Transactional
    public void attach(String command, boolean resume) {
        db.update("UPDATE hr_send_command SET transport='WINDOWS_VISUAL' WHERE command_id=?",command);
        db.update("INSERT INTO hr_send_step(id,command_id,ordinal,action_type) VALUES (?,?,0,'TEXT')",UUID.randomUUID().toString(),command);
        if(resume) db.update("INSERT INTO hr_send_step(id,command_id,ordinal,action_type) VALUES (?,?,1,'RESUME_NATIVE')",UUID.randomUUID().toString(),command);
    }
    public void attachResumeOnly(String command) {
        db.update("UPDATE hr_send_command SET transport='WINDOWS_VISUAL' WHERE command_id=?",command);
        db.update("INSERT INTO hr_send_step(id,command_id,ordinal,action_type) VALUES (?,?,0,'RESUME_NATIVE')",UUID.randomUUID().toString(),command);
    }
    public Map<String,Object> resumeRule(Long profile) {
        var rows=db.queryForList("SELECT enabled,version,state,reason,last_scan FROM hr_resume_rule WHERE profile_id=?",profile);
        if(rows.isEmpty()) return Map.of("enabled",false,"version",0,"state","STOPPED","reason","尚未授权","last_scan",0L);
        var row=rows.getFirst();row.put("enabled",((Number)row.get("enabled")).intValue()==1);return row;
    }
    public String resumeAccount(Long profile) {
        return crypto.decrypt(db.queryForObject("SELECT account_cipher FROM hr_resume_rule WHERE profile_id=?",String.class,profile),"resume-rule:"+profile);
    }
    public void configureResumeRule(Long profile,boolean enabled,String account) {
        db.update("""
            INSERT INTO hr_resume_rule(profile_id,enabled,account_cipher,state) VALUES (?,?,?,?)
            ON CONFLICT(profile_id) DO UPDATE SET enabled=excluded.enabled,account_cipher=excluded.account_cipher,
              state=excluded.state,reason='',last_scan=0,version=hr_resume_rule.version+1,updated_at=CURRENT_TIMESTAMP
            """,profile,enabled?1:0,crypto.encrypt(account,"resume-rule:"+profile),enabled?"WATCHING":"STOPPED");
    }
    public void resumeRuleState(Long profile,String state,String reason) {
        db.update("UPDATE hr_resume_rule SET state=?,reason=?,updated_at=CURRENT_TIMESTAMP WHERE profile_id=?",state,reason,profile);
    }
    public boolean resumeRuleActive(Long profile) {
        var r=resumeRule(profile);return Boolean.TRUE.equals(r.get("enabled")) && "WATCHING".equals(r.get("state"));
    }
    public void discoveredResumeContacts(Long profile,com.fasterxml.jackson.databind.JsonNode contacts) {
        long now=System.currentTimeMillis();
        for(var c:contacts) {
            String key=crypto.blindIndex(HrVisualService.normalize(c.path("hrName").asText())+"|"+HrVisualService.normalize(c.path("companyName").asText()),"resume-contact:"+profile);
            db.update("""
                INSERT INTO hr_resume_contact_scan(profile_id,identity_hash,contact_cipher,preview_hash,seen_at) VALUES (?,?,?,?,?)
                ON CONFLICT(profile_id,identity_hash) DO UPDATE SET contact_cipher=excluded.contact_cipher,preview_hash=excluded.preview_hash,seen_at=excluded.seen_at
                """,profile,key,encrypt(c,"resume-contact:"+profile+":"+key),c.path("previewKey").asText(),now);
        }
        db.update("UPDATE hr_resume_rule SET last_scan=? WHERE profile_id=?",now,profile);
    }
    public com.fasterxml.jackson.databind.JsonNode nextResumeContact(Long profile) {
        var rows=db.queryForList("""
            SELECT identity_hash,contact_cipher FROM hr_resume_contact_scan WHERE profile_id=?
              AND seen_at=(SELECT last_scan FROM hr_resume_rule WHERE profile_id=?)
              AND (checked_preview_hash IS NULL OR checked_preview_hash<>preview_hash) ORDER BY rowid LIMIT 1
            """,profile,profile);
        if(rows.isEmpty())return null;
        var row=rows.getFirst();String key=(String)row.get("identity_hash");
        try {var result=(com.fasterxml.jackson.databind.node.ObjectNode)json.readTree(crypto.decrypt((String)row.get("contact_cipher"),"resume-contact:"+profile+":"+key));result.put("identityKey",key);return result;}
        catch(Exception e){throw new IllegalStateException("简历巡检联系人不可读取",e);}
    }
    public void checkedResumeContact(Long profile,com.fasterxml.jackson.databind.JsonNode contact) {
        db.update("UPDATE hr_resume_contact_scan SET checked_preview_hash=? WHERE profile_id=? AND identity_hash=?",
                contact.path("previewKey").asText(),profile,contact.path("identityKey").asText());
    }
    public boolean resumeAttempted(Long profile,long conversation,String hash) {
        return count("SELECT COUNT(*) FROM hr_resume_rule_attempt WHERE profile_id=? AND conversation_id=? AND request_hash=?",profile,conversation,hash)>0;
    }
    public String resumeRequestHash(Long profile,Object request) {return crypto.blindIndex(json.valueToTree(request).toString(),"resume-request:"+profile);}
    public void recordResumeAttempt(Long profile,long conversation,String hash,String run,Object request) {
        db.update("INSERT INTO hr_resume_rule_attempt(profile_id,conversation_id,request_hash,rule_version,run_id,request_cipher) VALUES (?,?,?,?,?,?)",
                profile,conversation,hash,resumeRule(profile).get("version"),run,encrypt(request,"resume-request:"+run));
    }
    public boolean isResumeRuleRun(String run) {return count("SELECT COUNT(*) FROM hr_resume_rule_attempt WHERE run_id=?",run)>0;}
    public boolean resumeRuleAuthorized(Long profile,String run) {
        return resumeRuleActive(profile) && count("SELECT COUNT(*) FROM hr_resume_rule_attempt a JOIN hr_resume_rule r ON r.profile_id=a.profile_id AND r.version=a.rule_version WHERE a.run_id=? AND a.profile_id=?",run,profile)==1;
    }
    public com.fasterxml.jackson.databind.JsonNode resumeRequest(String run) {
        try {return json.readTree(crypto.decrypt(db.queryForObject("SELECT request_cipher FROM hr_resume_rule_attempt WHERE run_id=?",String.class,run),"resume-request:"+run));}
        catch(Exception e){throw new IllegalStateException("简历规则来源不可核验",e);}
    }
    public List<Map<String,Object>> resumeResults(Long profile) {
        return db.queryForList("SELECT a.run_id,t.proposal_id,t.status,t.reason FROM hr_resume_rule_attempt a JOIN hr_visual_target t ON t.run_id=a.run_id WHERE a.profile_id=? ORDER BY a.rowid DESC LIMIT 20",profile);
    }
    public List<Map<String,Object>> steps(long proposal) {
        return db.queryForList("SELECT s.id,s.ordinal,s.action_type,s.status,s.submitted_at,s.finished_at,r.reviewed_at FROM hr_send_step s JOIN hr_send_command c ON c.command_id=s.command_id LEFT JOIN hr_visual_receipt_review r ON r.step_id=s.id WHERE c.proposal_id=? ORDER BY s.ordinal",proposal);
    }
    public com.fasterxml.jackson.databind.JsonNode stepEvidence(String step) {
        String encoded=db.queryForObject("SELECT evidence_cipher FROM hr_send_step WHERE id=?",String.class,step);
        if(encoded==null || encoded.isBlank())return null;
        try {return json.readTree(crypto.decrypt(encoded,"visual-evidence:"+step));}
        catch(Exception e){throw new IllegalStateException("原发送前证据不可核验",e);}
    }
    public String commandId(String step) {return db.queryForObject("SELECT command_id FROM hr_send_step WHERE id=?",String.class,step);}
    public void resumeRemaining(String command) {
        if(db.update("UPDATE hr_send_command SET status='PENDING',outcome=NULL WHERE command_id=? AND EXISTS (SELECT 1 FROM hr_send_step WHERE command_id=? AND status='PENDING') AND NOT EXISTS (SELECT 1 FROM hr_send_step WHERE command_id=? AND status NOT IN ('PENDING','SENT_CONFIRMED'))",command,command,command)!=1)
            throw new IllegalStateException("剩余步骤并非全部未提交，不能继续");
    }
    @Transactional
    public void reconcileStep(String step,Object evidence) {
        if(db.update("INSERT INTO hr_visual_receipt_review(step_id,previous_status,original_evidence_cipher) SELECT id,status,evidence_cipher FROM hr_send_step WHERE id=? AND status='SEND_UNKNOWN'",step)!=1)
            throw new IllegalStateException("原步骤已处理，未修改回执");
        db.update("UPDATE hr_send_step SET status='SENT_CONFIRMED',evidence_cipher=? WHERE id=? AND status='SEND_UNKNOWN'",encrypt(evidence,"visual-evidence:"+step),step);
    }
    public boolean explicitlyReconfirmed(long proposal) {
        return count("SELECT COUNT(*) FROM hr_visual_reconfirmation WHERE new_proposal_id=?",proposal)>0;
    }
    public List<Map<String,Object>> previousAttempts(String target) {
        return db.queryForList("""
            SELECT r.old_proposal_id,r.new_proposal_id,r.reason,r.created_at,s.action_type,s.status,s.submitted_at,s.finished_at
            FROM hr_visual_reconfirmation r JOIN hr_send_command c ON c.proposal_id=r.old_proposal_id
            JOIN hr_send_step s ON s.command_id=c.command_id WHERE r.target_id=? ORDER BY r.created_at,s.ordinal
            """,target);
    }
    public void recordReconfirmation(String target,long oldProposal,long newProposal) {
        db.update("INSERT INTO hr_visual_reconfirmation(old_proposal_id,new_proposal_id,target_id,reason) VALUES (?,?,?,?)",
                oldProposal,newProposal,target,"本人在核对未发送现场后再次确认；原始失败或未知记录保持不变");
    }
    public boolean hasOtherLaterAttempt(long conversation,long proposal) {
        return count("SELECT COUNT(*) FROM hr_reply_proposal WHERE conversation_id=? AND id>? AND status IN ('APPROVED','SENDING','SENT_CONFIRMED','SEND_UNKNOWN','BLOCKED')",conversation,proposal)>0;
    }
    public boolean previousUnknownAttempt(String target) {
        return count("SELECT COUNT(*) FROM hr_reply_proposal WHERE status='SEND_UNKNOWN' AND id IN (SELECT old_proposal_id FROM hr_visual_reconfirmation WHERE target_id=?)",target)>0;
    }
    @Transactional
    public Step claim(Long profile,long proposal) {
        long now=System.currentTimeMillis();
        if(count("SELECT COUNT(*) FROM hr_send_step WHERE status IN ('PREPARED','SUBMITTING')")>0) return null;
        if(count("SELECT COUNT(*) FROM hr_send_command WHERE transport='CHROME_BRIDGE' AND status='LEASED'")>0) return null;
        if(count("SELECT COUNT(*) FROM hr_send_step WHERE finished_at>?",now-5000)>0) return null;
        var ids=db.queryForList("""
            SELECT s.id FROM hr_send_step s JOIN hr_send_command c ON c.command_id=s.command_id
            JOIN hr_reply_proposal p ON p.id=c.proposal_id JOIN hr_visual_target t ON t.proposal_id=p.id
            JOIN hr_visual_run r ON r.id=t.run_id
            WHERE c.profile_id=? AND c.proposal_id=? AND c.transport='WINDOWS_VISUAL'
              AND c.status IN ('PENDING','LEASED') AND p.status IN ('APPROVED','SENDING')
              AND c.expires_at>datetime('now','localtime') AND r.status='RUNNING' AND s.status='PENDING'
              AND NOT EXISTS (SELECT 1 FROM hr_send_step earlier WHERE earlier.command_id=c.command_id
                AND earlier.ordinal<s.ordinal AND earlier.status<>'SENT_CONFIRMED') ORDER BY s.ordinal LIMIT 1
            """,String.class,profile,proposal);
        if(ids.isEmpty()) return null;
        String id=ids.getFirst(),token=UUID.randomUUID().toString();
        if(db.update("UPDATE hr_send_step SET status='PREPARED',lease_hash=?,lease_expires_at=? WHERE id=? AND status='PENDING'",
                crypto.blindIndex(token,"visual-lease:"+id),now+60000,id)!=1) return null;
        var step=db.queryForMap("SELECT command_id,ordinal,action_type FROM hr_send_step WHERE id=?",id);
        db.update("UPDATE hr_send_command SET status='LEASED',updated_at=CURRENT_TIMESTAMP WHERE command_id=?",step.get("command_id"));
        db.update("UPDATE hr_reply_proposal SET status='SENDING' WHERE id=?",proposal);
        return new Step(id,(String)step.get("command_id"),((Number)step.get("ordinal")).intValue(),(String)step.get("action_type"),token);
    }
    public void submitting(Step step) {submitting(step,null);}
    public void submitting(Step step,Object before) {
        String checkpoint=before==null?null:encrypt(Map.of("submissionAuthorized",true,"before",before,"detail","提交授权已记录，尚不能视为发送成功"),"visual-evidence:"+step.id());
        if(db.update("UPDATE hr_send_step SET status='SUBMITTING',submitted_at=?,evidence_cipher=COALESCE(?,evidence_cipher) WHERE id=? AND status='PREPARED' AND lease_hash=? AND lease_expires_at>?",
                System.currentTimeMillis(),checkpoint,step.id(),crypto.blindIndex(step.leaseToken(),"visual-lease:"+step.id()),System.currentTimeMillis())!=1)
            throw new IllegalStateException("视觉步骤租约已失效，未允许提交");
    }
    public void finish(Step step,String outcome,Object evidence) {
        if(!Set.of("SENT_CONFIRMED","SEND_UNKNOWN","BLOCKED","STALE").contains(outcome)) throw new IllegalArgumentException("非法发送结果");
        var combined=json.valueToTree(evidence);
        var checkpoint=stepEvidence(step.id());
        if(combined instanceof com.fasterxml.jackson.databind.node.ObjectNode object && checkpoint!=null && checkpoint.has("before") && !object.hasNonNull("before")) {
            object.set("before",checkpoint.path("before"));
            object.put("submissionAuthorized",checkpoint.path("submissionAuthorized").asBoolean());
        }
        if(db.update("UPDATE hr_send_step SET status=?,finished_at=?,evidence_cipher=?,lease_hash=NULL WHERE id=? AND status IN ('PREPARED','SUBMITTING') AND lease_hash=?",
                outcome,System.currentTimeMillis(),encrypt(combined,"visual-evidence:"+step.id()),step.id(),crypto.blindIndex(step.leaseToken(),"visual-lease:"+step.id()))!=1)
            throw new IllegalStateException("步骤已完成或回执不属于当前租约");
    }
    public void completeParent(String command,String outcome) {
        db.update("UPDATE hr_send_command SET status='COMPLETE',outcome=?,updated_at=CURRENT_TIMESTAMP WHERE command_id=?",outcome,command);
    }
    public void releaseIdleParentLeases(String run) {
        db.update("""
            UPDATE hr_send_command SET status='PENDING' WHERE transport='WINDOWS_VISUAL' AND status='LEASED'
            AND proposal_id IN (SELECT proposal_id FROM hr_visual_target WHERE run_id=?)
            AND NOT EXISTS (SELECT 1 FROM hr_send_step s WHERE s.command_id=hr_send_command.command_id AND s.status IN ('PREPARED','SUBMITTING'))
            """,run);
    }
    @Transactional
    public void expire(String run) {
        // Only definitely unsubmitted steps expire. Submitted/unknown receipts are retained.
        db.update("""
            UPDATE hr_visual_target SET status='STALE',reason='确认或排队已过期，需要重新读取并确认'
            WHERE run_id=? AND status IN ('REVIEW_REQUIRED','QUEUED','PARTIAL') AND proposal_id IN (
                SELECT p.id FROM hr_reply_proposal p WHERE p.expires_at<=datetime('now','localtime') OR p.status='EXPIRED')
            """,run);
        db.update("""
            UPDATE hr_send_step SET status='STALE',finished_at=? WHERE status='PENDING' AND command_id IN (
                SELECT c.command_id FROM hr_send_command c JOIN hr_visual_target t ON t.proposal_id=c.proposal_id
                WHERE t.run_id=? AND t.status='STALE')
            """,System.currentTimeMillis(),run);
        db.update("""
            UPDATE hr_send_command SET status='STALE',outcome='EXPIRED_UNSENT' WHERE transport='WINDOWS_VISUAL'
            AND status IN ('PENDING','LEASED') AND proposal_id IN (SELECT proposal_id FROM hr_visual_target WHERE run_id=? AND status='STALE')
            """,run);
        db.update("""
            UPDATE hr_reply_proposal SET status='EXPIRED',version=version+1 WHERE status IN ('REVIEW_REQUIRED','APPROVED','SENDING')
            AND id IN (SELECT proposal_id FROM hr_visual_target WHERE run_id=? AND status='STALE')
            """,run);
    }
    @Transactional
    public List<Long> recover() {
        // Never reissue a possibly submitted action after a process/service crash.
        var proposals=db.queryForList("SELECT DISTINCT c.proposal_id FROM hr_send_command c JOIN hr_send_step s ON s.command_id=c.command_id WHERE s.status IN ('PREPARED','SUBMITTING')",Long.class);
        db.update("UPDATE hr_send_step SET status='SEND_UNKNOWN',finished_at=?,lease_hash=NULL WHERE status IN ('PREPARED','SUBMITTING')",System.currentTimeMillis());
        db.update("UPDATE hr_send_command SET status='COMPLETE',outcome='SEND_UNKNOWN' WHERE transport='WINDOWS_VISUAL' AND command_id IN (SELECT command_id FROM hr_send_step WHERE status='SEND_UNKNOWN')");
        db.update("UPDATE hr_send_command SET status='PENDING' WHERE transport='WINDOWS_VISUAL' AND status='LEASED'");
        db.update("UPDATE hr_visual_target SET status='SEND_UNKNOWN',reason='进程重启，未取得确定回执' WHERE proposal_id IN (SELECT c.proposal_id FROM hr_send_command c WHERE c.transport='WINDOWS_VISUAL' AND c.outcome='SEND_UNKNOWN')");
        db.update("UPDATE hr_visual_run SET status='PAUSED',reason='服务已重启，请恢复后重新核对未发送步骤' WHERE status IN ('RUNNING','STOPPING')");
        return proposals;
    }
    @Transactional
    public List<String> purgeSensitiveCopies() {
        db.update("DELETE FROM hr_resume_contact_scan WHERE seen_at<?",System.currentTimeMillis()-30L*24*60*60*1000);
        var runs=db.queryForList("""
            SELECT r.id FROM hr_visual_run r LEFT JOIN hr_assistant_settings a ON a.profile_id=r.profile_id
            WHERE r.status NOT IN ('RUNNING','STOPPING','ARCHIVED')
            AND r.created_at<datetime('now','-'||COALESCE(a.retention_days,30)||' days')
            """,String.class);
        var files=new ArrayList<>(db.queryForList("SELECT s.id FROM hr_send_step s JOIN hr_send_command c ON c.command_id=s.command_id JOIN hr_visual_target t ON t.proposal_id=c.proposal_id OR c.proposal_id IN (SELECT old_proposal_id FROM hr_visual_reconfirmation WHERE target_id=t.id) JOIN hr_visual_run r ON r.id=t.run_id WHERE r.status='ARCHIVED'",String.class));
        for(String run:runs) {
            var ids=db.queryForList("SELECT s.id FROM hr_send_step s JOIN hr_send_command c ON c.command_id=s.command_id JOIN hr_visual_target t ON t.proposal_id=c.proposal_id OR c.proposal_id IN (SELECT old_proposal_id FROM hr_visual_reconfirmation WHERE target_id=t.id) WHERE t.run_id=?",String.class,run);
            files.addAll(ids);
            for(String id:ids){
                db.update("UPDATE hr_send_step SET evidence_cipher=NULL WHERE id=?",id);
                db.update("UPDATE hr_visual_receipt_review SET original_evidence_cipher=NULL WHERE step_id=?",id);
            }
            for(Target target:targets(run)) {
                var empty=new com.getjobs.application.hr.HrAssistantTypes.ChatCapture("",0,null,List.of(),false,false);
                seed(target.id(),new Seed("","已清理","已清理","","",false,false,empty));
            }
            db.update("UPDATE hr_visual_run SET status='ARCHIVED',account_cipher=?,reason='正文按保留期清理；步骤结果与未知状态保留' WHERE id=?",crypto.encrypt("已清理","visual-account:"+run),run);
            db.update("UPDATE hr_resume_rule_attempt SET request_cipher=? WHERE run_id=?",crypto.encrypt("{}","resume-request:"+run),run);
        }
        return files;
    }
    private int count(String sql,Object...args) { return Objects.requireNonNull(db.queryForObject(sql,Integer.class,args)); }
    private String encrypt(Object o,String aad) { try{return crypto.encrypt(json.writeValueAsString(o),aad);}catch(Exception e){throw new IllegalStateException("视觉记录加密失败",e);} }
    private Seed read(String s,String aad) {try{return json.readValue(crypto.decrypt(s,aad),Seed.class);}catch(Exception e){throw new IllegalStateException("视觉记录读取失败",e);} }
}
