package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.opportunity.OpportunityStage;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Instant;
import java.time.ZoneId;
import java.util.*;

@Service
@RequiredArgsConstructor
public class InterviewService {
    private final JdbcTemplate jdbc;
    private final ProfileService profiles;
    private final PlatformTransactionManager transactions;
    private final HrAssistantCryptoService crypto;
    private final ObjectMapper json;
    private static final Set<String> STATUSES=Set.of("PENDING","SCHEDULED","COMPLETED","CANCELLED");
    private static final Set<String> MODES=Set.of("ONLINE","PHONE","ONSITE","OTHER");
    public static final Set<String> PREPARATION=Set.of("TIME_LOCATION","JOB_RESUME","PROJECT_STORIES","QUESTIONS");

    public Map<String,Object> list(Long opportunityId,int page,int size) {
        long profile=profiles.getCurrentProfileId();
        int safePage=Math.max(1,Math.min(10001,page)),limit=Math.max(1,Math.min(100,size));
        List<Object> parameters=new ArrayList<>(List.of(profile));
        String filter=" WHERE i.profile_id=?";
        if(opportunityId!=null) { owned(opportunityId,profile); filter+=" AND i.opportunity_id=?";parameters.add(opportunityId); }
        long total=jdbc.queryForObject("SELECT COUNT(*) FROM interview i"+filter,Long.class,parameters.toArray());
        parameters.add(limit);parameters.add((safePage-1)*limit);
        var rows=jdbc.queryForList("SELECT i.*,o.job_name,o.company_name,o.archived,o.version AS opportunity_version FROM interview i JOIN opportunity o ON o.id=i.opportunity_id"+filter+
            " ORDER BY CASE i.status WHEN 'SCHEDULED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END,i.scheduled_at,i.id DESC LIMIT ? OFFSET ?",parameters.toArray());
        for(var row:rows) {
            row.put("note",crypto.decrypt((String)row.remove("note_cipher"),aad(profile,((Number)row.get("id")).longValue())));
            try { row.put("preparation",json.readTree((String)row.remove("preparation_json"))); }
            catch(Exception error) { throw new IllegalStateException("面试准备记录无法读取",error); }
        }
        return Map.of("items",rows,"total",total,"page",safePage,"size",limit,"profileId",profile);
    }

    public Map<String,Object> save(long opportunityId,Save request) {
        if(request==null || request.eventKey()==null || !request.eventKey().matches("[A-Za-z0-9:_-]{1,100}")) throw new IllegalArgumentException("缺少有效操作标识");
        if(request.status()==null || !STATUSES.contains(request.status()) || request.mode()==null || !MODES.contains(request.mode())) throw new IllegalArgumentException("面试状态或方式无效");
        if(request.round()<1 || request.round()>100) throw new IllegalArgumentException("面试轮次须在 1 到 100 之间");
        String scheduled=request.scheduledAt()==null||request.scheduledAt().isBlank()?null:Instant.parse(request.scheduledAt()).toString();
        if("SCHEDULED".equals(request.status()) && scheduled==null) throw new IllegalArgumentException("已安排面试必须有确认时间");
        if("COMPLETED".equals(request.status()) && scheduled!=null && Instant.parse(scheduled).isAfter(Instant.now())) throw new IllegalArgumentException("未来面试不能标记为已完成，请核对实际时间");
        String timezone=ZoneId.of(request.timezone()==null?"Asia/Shanghai":request.timezone()).getId();
        if(request.preparation()!=null && (request.preparation().size()>4 || request.preparation().stream().anyMatch(Objects::isNull))) throw new IllegalArgumentException("面试准备项目无效");
        var preparation=new TreeSet<>(request.preparation()==null?List.of():request.preparation());
        if(!PREPARATION.containsAll(preparation)) throw new IllegalArgumentException("面试准备项目无效");
        if(request.note()!=null && request.note().length()>4000) throw new IllegalArgumentException("面试备注最多 4000 字");
        long profile=profiles.getCurrentProfileId();
        String hash=crypto.blindIndex(write(request),"interview-command:"+opportunityId);
        return new TransactionTemplate(transactions).execute(status->{
            jdbc.update("UPDATE opportunity SET version=version WHERE id=-1");
            var opportunity=owned(opportunityId,profile);
            String key="interview:"+request.eventKey();
            var duplicates=jdbc.queryForList("SELECT opportunity_id,json_extract(payload,'$.commandHash') AS hash,json_extract(payload,'$.interviewId') AS interview_id FROM opportunity_event WHERE profile_id=? AND event_key=?",profile,key);
            if(!duplicates.isEmpty()) {
                var duplicate=duplicates.getFirst();
                if(((Number)duplicate.get("opportunity_id")).longValue()!=opportunityId || !hash.equals(duplicate.get("hash"))) throw new IllegalArgumentException("操作标识已用于其他面试内容");
                return Map.of("success",true,"duplicate",true,"id",duplicate.get("interview_id"));
            }
            if(((Number)opportunity.get("version")).longValue()!=request.opportunityVersion()) throw new IllegalStateException("机会已更新，请刷新后再保存面试");
            var stage=OpportunityStage.valueOf((String)opportunity.get("stage"));
            if("SCHEDULED".equals(request.status()) && (stage.terminal() || ((Number)opportunity.get("archived")).intValue()==1)) throw new IllegalArgumentException("请先恢复机会或更正求职结果，再安排面试");
            Map<String,Object> old=null;
            if(request.id()!=null) {
                var rows=jdbc.queryForList("SELECT * FROM interview WHERE id=? AND opportunity_id=? AND profile_id=?",request.id(),opportunityId,profile);
                if(rows.isEmpty()) throw new IllegalArgumentException("面试不属于当前机会");
                old=rows.getFirst();
                if(((Number)old.get("version")).longValue()!=request.version()) throw new IllegalStateException("面试已更新，请刷新后再保存");
            }
            if(jdbc.queryForObject("SELECT COUNT(*) FROM interview WHERE opportunity_id=? AND round_number=? AND id<>?",Integer.class,opportunityId,request.round(),request.id()==null?-1:request.id())>0)
                throw new IllegalArgumentException("该轮面试已存在，请在原记录中改期或修改");
            long id;
            if(old==null) {
                id=jdbc.queryForObject("INSERT INTO interview(opportunity_id,profile_id,round_number,scheduled_at,timezone,mode,status,preparation_json) VALUES(?,?,?,?,?,?,?,?) RETURNING id",Long.class,
                    opportunityId,profile,request.round(),scheduled,timezone,request.mode(),request.status(),write(preparation));
                jdbc.update("UPDATE interview SET note_cipher=? WHERE id=?",crypto.encrypt(request.note(),aad(profile,id)),id);
            } else {
                id=request.id();
                jdbc.update("UPDATE interview SET round_number=?,scheduled_at=?,timezone=?,mode=?,status=?,preparation_json=?,note_cipher=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                    request.round(),scheduled,timezone,request.mode(),request.status(),write(preparation),crypto.encrypt(request.note(),aad(profile,id)),id);
            }
            if(Set.of("SCHEDULED","COMPLETED").contains(request.status())) stage=stage.observe(OpportunityStage.INTERVIEW);
            var payload=new LinkedHashMap<String,Object>();
            payload.put("interviewId",id);payload.put("round",request.round());payload.put("status",request.status());payload.put("scheduledAt",scheduled);payload.put("timezone",timezone);payload.put("mode",request.mode());
            payload.put("previousStatus",old==null?null:old.get("status"));payload.put("previousScheduledAt",old==null?null:old.get("scheduled_at"));payload.put("preparation",preparation);payload.put("commandHash",hash);
            jdbc.update("INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,occurred_at,payload) VALUES(?,?,?,?,'USER',CURRENT_TIMESTAMP,?)",
                opportunityId,profile,key,old==null?"INTERVIEW_CREATED":"INTERVIEW_UPDATED",write(payload));
            jdbc.update("UPDATE opportunity SET stage=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",stage.name(),opportunityId);
            return Map.of("success",true,"id",id);
        });
    }
    private Map<String,Object> owned(long id,long profile) {
        var rows=jdbc.queryForList("SELECT id,version,stage,archived FROM opportunity WHERE id=? AND profile_id=?",id,profile);
        if(rows.isEmpty()) throw new IllegalArgumentException("求职机会不存在或不属于当前档案");
        return rows.getFirst();
    }
    private String aad(long profile,long id) { return "interview:"+profile+":"+id; }
    private String write(Object value) {
        try { return json.writeValueAsString(value); }
        catch(Exception error) { throw new IllegalArgumentException("面试记录格式无效",error); }
    }
    public record Save(Long id,long version,long opportunityVersion,String eventKey,int round,String scheduledAt,String timezone,String mode,String status,List<String> preparation,String note) {}
}
