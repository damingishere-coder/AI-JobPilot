package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.opportunity.OpportunityStage;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Instant;
import java.util.*;

/** User-confirmed feedback. Neither message classification nor an HR name establishes an outcome. */
@Service
@RequiredArgsConstructor
public class OpportunityFeedbackService {
    private final JdbcTemplate jdbc;
    private final PlatformTransactionManager transactions;
    private final ProfileService profiles;
    private final HrAssistantStore hr;
    private final HrAssistantCryptoService crypto;
    private final ObjectMapper json;
    private static final Set<String> TYPES=Set.of("RECRUITER_REPLIED","CHATTING","PHONE_SCREEN","INTERVIEW_INVITED","OFFER","REJECTED","WITHDRAWN","NO_REPLY_OBSERVED","NO_INTERVIEW_OBSERVED");
    private static boolean absence(String type) { return Set.of("NO_REPLY_OBSERVED","NO_INTERVIEW_OBSERVED").contains(type); }

    public List<Map<String,Object>> conversations(long opportunityId) {
        var opportunity=owned(opportunityId);
        long profile=((Number)opportunity.get("profile_id")).longValue();
        var rows=jdbc.queryForList("SELECT c.id,c.external_uid_hash,c.hr_name_cipher,c.company_name_cipher,c.job_name_cipher,c.job_key,c.last_observed_at," +
            "COALESCE(l.active,0) AS linked,(SELECT COUNT(*) FROM opportunity_conversation a WHERE a.conversation_id=c.id AND a.active=1) AS linked_count " +
            "FROM hr_conversation c LEFT JOIN opportunity_conversation l ON l.conversation_id=c.id AND l.opportunity_id=? " +
            "WHERE c.profile_id=? AND c.platform=? ORDER BY COALESCE(l.active,0) DESC,c.last_observed_at DESC LIMIT 100",opportunityId,profile,opportunity.get("platform"));
        for(var row:rows) {
            String aad="conversation:"+profile+":"+row.remove("external_uid_hash");
            row.put("hrName",crypto.decrypt((String)row.remove("hr_name_cipher"),aad+":hr"));
            row.put("companyName",crypto.decrypt((String)row.remove("company_name_cipher"),aad+":company"));
            row.put("jobName",crypto.decrypt((String)row.remove("job_name_cipher"),aad+":job"));
            row.put("candidate",Objects.equals(opportunity.get("job_key"),row.remove("job_key")));
        }
        return rows;
    }

    public Object messages(long opportunityId,long conversationId) {
        var opportunity=owned(opportunityId);
        requireLinked(opportunity,conversationId);
        return hr.recentMessages(conversationId,50);
    }

    public Map<String,Object> link(long id,Link request) {
        if(request==null) throw new IllegalArgumentException("缺少关联操作");
        return new TransactionTemplate(transactions).execute(status->{
            var opportunity=locked(id);
            long profile=((Number)opportunity.get("profile_id")).longValue();
            String eventKey="link:"+request.eventKey();
            String hash=hash(id,request);
            if(duplicate(profile,id,eventKey,hash)) return Map.of("success",true,"duplicate",true);
            requireVersion(opportunity,request.version());
            if(jdbc.queryForObject("SELECT COUNT(*) FROM hr_conversation WHERE id=? AND profile_id=? AND platform=?",Integer.class,request.conversationId(),profile,opportunity.get("platform"))!=1)
                throw new IllegalArgumentException("会话不属于当前档案和平台");
            jdbc.update("INSERT INTO opportunity_conversation(opportunity_id,conversation_id,profile_id,active) VALUES(?,?,?,?) " +
                "ON CONFLICT(opportunity_id,conversation_id) DO UPDATE SET active=excluded.active,updated_at=CURRENT_TIMESTAMP",id,request.conversationId(),profile,request.active()?1:0);
            append(id,profile,eventKey,request.active()?"CONVERSATION_LINKED":"CONVERSATION_UNLINKED",null,
                Map.of("conversationId",request.conversationId(),"commandHash",hash),null);
            jdbc.update("UPDATE opportunity SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",id);
            return Map.of("success",true);
        });
    }

    public Map<String,Object> feedback(long id,Feedback request) {
        if(request==null || request.type()==null || !TYPES.contains(request.type())) throw new IllegalArgumentException("反馈类型无效");
        String occurred=time(request.occurredAt());
        String observed=time(request.observedUntil());
        if(absence(request.type()) && observed==null) throw new IllegalArgumentException("请填写已核对结果的截止时间");
        if(request.note()!=null && request.note().length()>1000) throw new IllegalArgumentException("备注最多 1000 字");
        return new TransactionTemplate(transactions).execute(status->{
            var opportunity=locked(id);
            long profile=((Number)opportunity.get("profile_id")).longValue();
            String eventKey="feedback:"+request.eventKey(),hash=hash(id,request);
            if(duplicate(profile,id,eventKey,hash)) return Map.of("success",true,"duplicate",true);
            requireVersion(opportunity,request.version());
            if(request.conversationId()!=null) requireLinked(opportunity,request.conversationId());
            if(request.attemptId()!=null && jdbc.queryForObject("SELECT COUNT(*) FROM delivery_attempt WHERE id=? AND profile_id=? AND platform=? AND job_key=? AND state='CONFIRMED'",Integer.class,
                request.attemptId(),profile,opportunity.get("platform"),opportunity.get("job_key"))!=1)
                throw new IllegalArgumentException("反馈投递记录不存在、未确认或属于其他机会");
            if(absence(request.type()) && request.attemptId()==null)
                throw new IllegalArgumentException("核对未回复须选择已确认投递记录");
            if(request.attemptId()!=null) {
                String observation=absence(request.type())?observed:occurred;
                // A successful callback may arrive after the HR response. Use the known
                // request boundary, never callback arrival time, as the earliest attribution.
                if(observation!=null && jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE opportunity_id=? AND type='APPLICATION_REQUESTED' AND json_extract(payload,'$.attemptId')=? AND occurred_at IS NOT NULL AND julianday(occurred_at)>julianday(?)",Integer.class,id,request.attemptId(),observation)>0)
                    throw new IllegalArgumentException("该反馈时间早于所选投递，请核对时间或移除投递归因");
            }
            if(request.actualSentResumeVersionId()!=null && (request.attemptId()==null || jdbc.queryForObject("SELECT COUNT(*) FROM resume_version WHERE id=? AND profile_id=?",Integer.class,request.actualSentResumeVersionId(),profile)!=1))
                throw new IllegalArgumentException("请指定已确认投递及当前档案中真实发送的简历版本");
            var stage=OpportunityStage.valueOf((String)opportunity.get("stage"));
            if(!absence(request.type()) && !"INTERVIEW_INVITED".equals(request.type())) {
                var target=OpportunityStage.valueOf(request.type());
                // Older positive observations cannot regress a later stage; conflicting terminal
                // outcomes must use the explicit correction workflow.
                stage=target.terminal()?stage.userChange(target,false):stage.observe(target);
            }
            Map<String,Object> payload=new LinkedHashMap<>();
            payload.put("commandHash",hash);payload.put("stage",stage.name());payload.put("attemptId",request.attemptId());
            payload.put("conversationId",request.conversationId());payload.put("observedUntil",observed);
            payload.put("actualSentResumeVersionId",request.actualSentResumeVersionId());
            String note=crypto.encrypt(request.note(),"opportunity:"+profile+":"+id+":reason");
            append(id,profile,eventKey,"OUTCOME_"+request.type(),occurred,payload,note);
            jdbc.update("UPDATE opportunity SET stage=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",stage.name(),id);
            return Map.of("success",true);
        });
    }

    private Map<String,Object> owned(long id) {
        var rows=jdbc.queryForList("SELECT id,profile_id,platform,job_key,stage,version FROM opportunity WHERE id=? AND profile_id=?",id,profiles.getCurrentProfileId());
        if(rows.isEmpty()) throw new IllegalArgumentException("机会不存在或不属于当前档案");
        return rows.getFirst();
    }
    private Map<String,Object> locked(long id) {
        jdbc.update("UPDATE opportunity SET version=version WHERE id=-1");
        return owned(id);
    }
    private void requireVersion(Map<String,Object> opportunity,long version) {
        if(((Number)opportunity.get("version")).longValue()!=version) throw new IllegalStateException("记录已更新，请刷新后再保存");
    }
    private void requireLinked(Map<String,Object> opportunity,long conversationId) {
        if(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_conversation l JOIN hr_conversation c ON c.id=l.conversation_id WHERE l.opportunity_id=? AND l.conversation_id=? AND l.profile_id=? AND c.profile_id=l.profile_id AND c.platform=? AND l.active=1",Integer.class,
            opportunity.get("id"),conversationId,opportunity.get("profile_id"),opportunity.get("platform"))!=1) throw new IllegalArgumentException("请先确认此会话与当前机会的关联");
    }
    private boolean duplicate(long profile,long id,String key,String hash) {
        if(!key.matches("[A-Za-z0-9:_-]{1,120}") || key.endsWith(":null")) throw new IllegalArgumentException("缺少有效操作标识");
        var rows=jdbc.queryForList("SELECT opportunity_id,json_extract(payload,'$.commandHash') AS hash FROM opportunity_event WHERE profile_id=? AND event_key=?",profile,key);
        if(rows.isEmpty()) return false;
        if(((Number)rows.getFirst().get("opportunity_id")).longValue()!=id || !hash.equals(rows.getFirst().get("hash"))) throw new IllegalArgumentException("操作标识已用于其他内容");
        return true;
    }
    private String hash(long id,Object request) {
        String key=request instanceof Link link?link.eventKey():((Feedback)request).eventKey();
        if(key==null || !key.matches("[A-Za-z0-9:_-]{1,100}")) throw new IllegalArgumentException("缺少有效操作标识");
        try { return crypto.blindIndex(json.writeValueAsString(request),"opportunity-feedback:"+id); }
        catch(Exception error) { throw new IllegalArgumentException("操作格式无效",error); }
    }
    private void append(long id,long profile,String key,String type,String occurred,Map<String,Object> payload,String note) {
        try { jdbc.update("INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,occurred_at,payload,reason_cipher) VALUES(?,?,?,?,'USER',?,?,?)",id,profile,key,type,occurred,json.writeValueAsString(payload),note); }
        catch(com.fasterxml.jackson.core.JsonProcessingException error) { throw new IllegalArgumentException("事件格式无效",error); }
    }
    private String time(String value) {
        if(value==null || value.isBlank()) return null;
        Instant instant=Instant.parse(value);
        if(instant.isAfter(Instant.now().plusSeconds(60))) throw new IllegalArgumentException("已发生的反馈或核对时间不能在未来");
        return instant.toString();
    }
    public record Link(long version,String eventKey,long conversationId,boolean active) {}
    public record Feedback(long version,String eventKey,String type,String occurredAt,String observedUntil,Long attemptId,Long conversationId,Long actualSentResumeVersionId,String note) {}
}
