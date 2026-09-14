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

@Service
@RequiredArgsConstructor
public class OpportunityService {
    private final JdbcTemplate jdbc;
    private final PlatformTransactionManager transactions;
    private final ProfileService profiles;
    private final HrAssistantCryptoService crypto;
    private final ObjectMapper json;

    public Map<String,Object> list(String stage,boolean archived,int page,int size) {
        long profile=profiles.getCurrentProfileId();
        int limit=Math.max(1,Math.min(100,size)),offset=Math.max(0,Math.min(10000,page-1))*limit;
        String filter=" WHERE o.profile_id=? AND o.archived=?";
        List<Object> args=new ArrayList<>(List.of(profile,archived?1:0));
        if(stage!=null&&!stage.isBlank()) { filter+=" AND o.stage=?";args.add(OpportunityStage.valueOf(stage).name()); }
        long total=jdbc.queryForObject("SELECT COUNT(*) FROM opportunity o"+filter,Long.class,args.toArray());
        args.add(limit);args.add(offset);
        var rows=jdbc.queryForList("SELECT o.id,o.platform,o.job_key,o.job_name,o.company_name,o.stage,o.interest,o.archived,o.follow_up_at,o.version,o.created_at,o.updated_at," +
            "COALESCE((SELECT a.state FROM delivery_attempt a WHERE a.profile_id=o.profile_id AND a.platform=o.platform AND a.job_key=o.job_key ORDER BY a.id DESC LIMIT 1),'NOT_REQUESTED') AS application_status " +
            "FROM opportunity o"+filter+" ORDER BY o.updated_at DESC,o.id DESC LIMIT ? OFFSET ?",args.toArray());
        return Map.of("items",rows,"total",total,"page",Math.max(1,page),"size",limit);
    }

    public Map<String,Object> detail(long id) {
        long profile=profiles.getCurrentProfileId();
        var row=owned(id,profile);
        row.put("note",crypto.decrypt((String)row.remove("note_cipher"),aad(id,profile,"note")));
        row.put("nextAction",crypto.decrypt((String)row.remove("next_action_cipher"),aad(id,profile,"next")));
        row.put("events",events(id,profile));
        row.put("applications",jdbc.queryForList("SELECT id,request_key,state,evidence,greeting_outcome,requested_at,resolved_at FROM delivery_attempt WHERE profile_id=? AND platform=? AND job_key=? ORDER BY id DESC",profile,row.get("platform"),row.get("job_key")));
        row.put("analyses",jdbc.queryForList("SELECT id,score,decision,summary,resume_version_id,created_at FROM job_ai_analysis WHERE profile_id=? AND platform=? AND job_key=? ORDER BY id DESC LIMIT 20",profile,row.get("platform"),row.get("job_key")));
        return row;
    }

    private List<Map<String,Object>> events(long id,long profile) {
        var rows=jdbc.queryForList("SELECT id,type,source,occurred_at,observed_at,payload,correction_of,reason_cipher FROM opportunity_event WHERE opportunity_id=? AND profile_id=? ORDER BY id DESC LIMIT 200",id,profile);
        for(var row:rows) row.put("reason",crypto.decrypt((String)row.remove("reason_cipher"),aad(id,profile,"reason")));
        return rows;
    }

    public Map<String,Object> change(long id,Change request) {
        if(request==null || request.eventKey()==null || !request.eventKey().matches("[A-Za-z0-9:_-]{1,100}")) throw new IllegalArgumentException("缺少有效操作标识");
        long profile=profiles.getCurrentProfileId();
        String fingerprint;
        try { fingerprint=crypto.blindIndex(json.writeValueAsString(request),"opportunity-change:"+id); }
        catch(Exception error) { throw new IllegalArgumentException("操作格式无效",error); }
        String commandHash=fingerprint;
        return new TransactionTemplate(transactions).execute(status->{
            jdbc.update("UPDATE opportunity SET version=version WHERE id=? AND profile_id=?",id,profile);
            var current=owned(id,profile);
            var duplicate=jdbc.queryForList("SELECT opportunity_id,payload FROM opportunity_event WHERE profile_id=? AND event_key=?",profile,"user:"+request.eventKey());
            if(!duplicate.isEmpty()) {
                try {
                    if(((Number)duplicate.getFirst().get("opportunity_id")).longValue()!=id || !commandHash.equals(json.readTree((String)duplicate.getFirst().get("payload")).path("commandHash").asText()))
                        throw new IllegalArgumentException("同一操作标识不能用于不同内容");
                } catch(com.fasterxml.jackson.core.JsonProcessingException error) { throw new IllegalStateException("历史操作记录无法校验",error); }
                return Map.of("success",true,"duplicate",true);
            }
            long version=((Number)current.get("version")).longValue();
            if(version!=request.version()) throw new IllegalStateException("记录已更新，请刷新后再保存");
            var oldStage=OpportunityStage.valueOf((String)current.get("stage"));
            var stage=oldStage;
            boolean correction=request.correctionOf()!=null;
            if(correction) {
                if(request.reason()==null || request.reason().isBlank()) throw new IllegalArgumentException("更正须填写原因");
                if(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE id=? AND opportunity_id=? AND profile_id=?",Integer.class,request.correctionOf(),id,profile)!=1)
                    throw new IllegalArgumentException("更正记录不属于当前机会");
            }
            if(request.stage()!=null) stage=stage.userChange(OpportunityStage.valueOf(request.stage()),correction);
            String interest=Objects.toString(current.get("interest"));
            if(request.interest()!=null) {
                if(!Set.of("UNDECIDED","INTERESTED","NOT_INTERESTED").contains(request.interest())) throw new IllegalArgumentException("兴趣状态无效");
                interest=request.interest();
                if("INTERESTED".equals(interest)) stage=stage.observe(OpportunityStage.SHORTLISTED);
            }
            int archived=request.archived()==null?((Number)current.get("archived")).intValue():request.archived()?1:0;
            if(archived==1 && ((Number)current.get("archived")).intValue()==0) {
                var unresolved=jdbc.queryForObject("SELECT (SELECT COUNT(*) FROM delivery_attempt WHERE profile_id=? AND platform=? AND job_key=? AND state IN('REQUESTED','UNKNOWN')) + " +
                    "(SELECT COUNT(*) FROM job_analysis_task WHERE profile_id=? AND platform=? AND job_key=? AND status IN('PENDING','LEASED','UNKNOWN'))",Integer.class,
                    profile,current.get("platform"),current.get("job_key"),profile,current.get("platform"),current.get("job_key"));
                if(unresolved>0) throw new IllegalStateException("请先处理该机会的执行中或 UNKNOWN 任务");
            }
            String followUp=(String)current.get("follow_up_at");
            if(request.followUpAt()!=null) followUp=request.followUpAt().isBlank()?null:Instant.parse(request.followUpAt()).toString();
            String occurred=request.occurredAt()==null||request.occurredAt().isBlank()?null:Instant.parse(request.occurredAt()).toString();
            String note=encrypted(request.note(),(String)current.get("note_cipher"),id,profile,"note",4000);
            String next=encrypted(request.nextAction(),(String)current.get("next_action_cipher"),id,profile,"next",500);
            String reason=encrypted(request.reason(),null,id,profile,"reason",1000);
            int changed=jdbc.update("UPDATE opportunity SET stage=?,interest=?,note_cipher=?,next_action_cipher=?,follow_up_at=?,archived=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND profile_id=? AND version=?",
                stage.name(),interest,note,next,followUp,archived,id,profile,version);
            if(changed!=1) throw new IllegalStateException("记录已更新，请刷新后再保存");
            String payload;
            try { payload=json.writeValueAsString(Map.of("previousStage",oldStage.name(),"stage",stage.name(),"interest",interest,"archived",archived,"commandHash",commandHash)); }
            catch(Exception error) { throw new IllegalStateException("无法保存事件",error); }
            jdbc.update("INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,occurred_at,payload,correction_of,reason_cipher) VALUES(?,?,?,?,'USER',?,?,?,?)",
                id,profile,"user:"+request.eventKey(),correction?"CORRECTION":"USER_UPDATED",occurred,payload,request.correctionOf(),reason);
            return Map.of("success",true,"version",version+1);
        });
    }

    private Map<String,Object> owned(long id,long profile) {
        var rows=jdbc.queryForList("SELECT * FROM opportunity WHERE id=? AND profile_id=?",id,profile);
        if(rows.isEmpty()) throw new IllegalArgumentException("求职机会不存在或不属于当前档案");
        return rows.getFirst();
    }
    private String encrypted(String value,String existing,long id,long profile,String field,int max) {
        if(value==null) return existing;
        if(value.length()>max) throw new IllegalArgumentException("内容过长："+field);
        return crypto.encrypt(value,aad(id,profile,field));
    }
    private String aad(long id,long profile,String field) { return "opportunity:"+profile+":"+id+":"+field; }
    public record Change(long version,String eventKey,String stage,String interest,String note,String nextAction,String followUpAt,Boolean archived,String occurredAt,Long correctionOf,String reason) {}
}
