package com.getjobs.application.service;

import com.getjobs.application.opportunity.OpportunityStage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.time.*;
import java.util.*;

/** Counts and drill-down lists share exactly the same predicates and time boundaries. */
@Service
public class OpportunityWorkbenchService {
    private final JdbcTemplate jdbc;
    private final ProfileService profiles;
    private final Clock clock;
    private static final ZoneId ZONE=ZoneId.of("Asia/Shanghai");
    @Autowired public OpportunityWorkbenchService(JdbcTemplate jdbc,ProfileService profiles) {
        this(jdbc,profiles,Clock.systemUTC());
    }
    OpportunityWorkbenchService(JdbcTemplate jdbc,ProfileService profiles,Clock clock) {
        this.jdbc=jdbc;this.profiles=profiles;this.clock=clock;
    }
    public enum Bucket {
        UNKNOWN("结果未知待对账",true),FAILED("失败待处理",true),WAITING_CONFIRM("等待确认投递",true),
        HR_REVIEW("HR 消息待核实",true),FOLLOW_UP("到期待跟进",true),RUNNING("投递请求中",false),
        AWAITING_REPLY("已投待回复",false),REPLIED("HR 已回复",false),CHATTING("沟通中",false),
        INTERVIEW_INVITED("面试邀请待安排",true),INTERVIEW_PREPARE("七天内面试待准备",true),INTERVIEW_CHECK("面试时间已过待核实",true),
        INTERVIEW_SCHEDULED("已约面试",false),INTERVIEW("面试阶段",false),OFFER("Offer",false),
        DISCOVERED_TODAY("今日新发现",false),HIGH_MATCH("较高匹配待关注",false);
        final String label;final boolean action;
        Bucket(String label,boolean action){this.label=label;this.action=action;}
    }
    private static final String FACTS="""
        WITH facts AS MATERIALIZED (
          SELECT o.*,
            COALESCE((SELECT a.state FROM delivery_attempt a WHERE a.profile_id=o.profile_id AND a.platform=o.platform AND a.job_key=o.job_key ORDER BY a.id DESC LIMIT 1),'NOT_REQUESTED') AS application_status,
            (SELECT a.score FROM job_ai_analysis a WHERE a.profile_id=o.profile_id AND a.platform=o.platform AND a.job_key=o.job_key ORDER BY a.id DESC LIMIT 1) AS match_score,
            CASE o.platform
              WHEN 'boss' THEN (SELECT b.delivery_status FROM boss_data b WHERE b.id=o.source_row_id AND b.profile_id=o.profile_id AND b.encrypt_id=o.job_key)
              WHEN 'zhilian' THEN (SELECT z.delivery_status FROM zhilian_data z WHERE z.id=o.source_row_id AND z.profile_id=o.profile_id AND z.job_id=o.job_key)
              ELSE NULL END AS job_status,
            EXISTS(SELECT 1 FROM opportunity_event e WHERE e.opportunity_id=o.id AND e.type='HR_INBOUND_OBSERVED'
              AND NOT EXISTS(SELECT 1 FROM opportunity_event r WHERE r.opportunity_id=o.id AND
                ((r.type='HR_OBSERVATIONS_REVIEWED' AND json_extract(r.payload,'$.throughEventId')>=e.id)
                 OR (r.type IN('OUTCOME_RECRUITER_REPLIED','OUTCOME_CHATTING','OUTCOME_PHONE_SCREEN','OUTCOME_INTERVIEW_INVITED','OUTCOME_OFFER','OUTCOME_REJECTED')
                   AND r.id>e.id AND json_extract(r.payload,'$.conversationId')=json_extract(e.payload,'$.conversationId'))))) AS hr_review,
            EXISTS(SELECT 1 FROM opportunity_event e WHERE e.opportunity_id=o.id AND e.type='OUTCOME_INTERVIEW_INVITED'
              AND NOT EXISTS(SELECT 1 FROM opportunity_event c WHERE c.correction_of=e.id)) AS interview_invited
          FROM opportunity o WHERE o.profile_id=?
        )
        """;
    private static String condition(Bucket bucket) {
        return switch(bucket) {
            case UNKNOWN -> "application_status='UNKNOWN'";
            case FAILED -> "application_status='FAILED'";
            case WAITING_CONFIRM -> "job_status='待确认' AND stage IN('DISCOVERED','SHORTLISTED') AND application_status NOT IN('REQUESTED','UNKNOWN')";
            case HR_REVIEW -> "hr_review=1";
            case FOLLOW_UP -> "follow_up_at IS NOT NULL AND julianday(follow_up_at)<=julianday(?) AND stage NOT IN('OFFER','REJECTED','WITHDRAWN')";
            case RUNNING -> "application_status='REQUESTED'";
            case AWAITING_REPLY -> "application_status='CONFIRMED' AND stage='APPLIED'";
            case REPLIED -> "stage='RECRUITER_REPLIED'";
            case CHATTING -> "stage IN('CHATTING','PHONE_SCREEN')";
            case INTERVIEW_INVITED -> "interview_invited=1 AND stage NOT IN('INTERVIEW','OFFER','REJECTED','WITHDRAWN')";
            case INTERVIEW_PREPARE -> "EXISTS(SELECT 1 FROM interview i WHERE i.opportunity_id=facts.id AND i.status='SCHEDULED' AND julianday(i.scheduled_at)>=julianday(?) AND julianday(i.scheduled_at)<julianday(?) AND json_array_length(i.preparation_json)<4)";
            case INTERVIEW_CHECK -> "EXISTS(SELECT 1 FROM interview i WHERE i.opportunity_id=facts.id AND i.status='SCHEDULED' AND julianday(i.scheduled_at)<julianday(?))";
            case INTERVIEW_SCHEDULED -> "EXISTS(SELECT 1 FROM interview i WHERE i.opportunity_id=facts.id AND i.status='SCHEDULED' AND julianday(i.scheduled_at)>=julianday(?))";
            case INTERVIEW -> "stage='INTERVIEW'";
            case OFFER -> "stage='OFFER'";
            case DISCOVERED_TODAY -> "origin<>'LEGACY_IMPORT' AND julianday(created_at)>=julianday(?) AND julianday(created_at)<julianday(?)";
            case HIGH_MATCH -> "stage IN('DISCOVERED','SHORTLISTED') AND interest<>'NOT_INTERESTED' AND match_score>=CASE platform WHEN 'zhilian' THEN 65 ELSE 75 END";
        };
    }
    private List<Object> args(long profile,Bucket bucket,Instant instant) {
        List<Object> args=new ArrayList<>();args.add(profile);
        if(bucket==Bucket.FOLLOW_UP) args.add(instant.toString());
        if(Set.of(Bucket.INTERVIEW_PREPARE,Bucket.INTERVIEW_CHECK,Bucket.INTERVIEW_SCHEDULED).contains(bucket)) args.add(instant.toString());
        if(bucket==Bucket.INTERVIEW_PREPARE) args.add(instant.plus(Duration.ofDays(7)).toString());
        if(bucket==Bucket.DISCOVERED_TODAY) {
            var start=instant.atZone(ZONE).toLocalDate().atStartOfDay(ZONE);
            args.add(start.toInstant().toString());args.add(start.plusDays(1).toInstant().toString());
        }
        return args;
    }
    public Map<String,Object> summary() {
        long profile=profiles.getCurrentProfileId();Instant instant=clock.instant();
        List<Object> parameters=new ArrayList<>(List.of(profile));
        List<String> columns=new ArrayList<>();
        for(Bucket bucket:Bucket.values()) {
            columns.add("COALESCE(SUM(CASE WHEN "+condition(bucket)+" THEN 1 ELSE 0 END),0) AS count_"+bucket.ordinal());
            var scoped=args(profile,bucket,instant);parameters.addAll(scoped.subList(1,scoped.size()));
        }
        var totals=jdbc.queryForMap(FACTS+"SELECT "+String.join(",",columns)+" FROM facts WHERE archived=0",parameters.toArray());
        List<Map<String,Object>> counts=new ArrayList<>();
        for(Bucket bucket:Bucket.values()) {
            long count=((Number)totals.get("count_"+bucket.ordinal())).longValue();
            counts.add(Map.of("bucket",bucket.name(),"label",bucket.label,"count",count,"actionRequired",bucket.action,
                "preview",bucket.action && count>0 ? listAt(profile,instant,bucket,null,false,1,3,null,null,null,count).get("items") : List.of()));
        }
        return Map.of("profileId",profile,"generatedAt",instant.toString(),"day",instant.atZone(ZONE).toLocalDate().toString(),"timezone",ZONE.toString(),"counts",counts);
    }
    public Map<String,Object> list(String bucketName,String stage,boolean archived,int page,int size) {
        return list(bucketName,stage,archived,page,size,null,null,null);
    }
    public Map<String,Object> list(String bucketName,String stage,boolean archived,int page,int size,String platform,String q,String applicationStatus) {
        Bucket bucket=bucketName==null || bucketName.isBlank()?null:Bucket.valueOf(bucketName);
        return listAt(profiles.getCurrentProfileId(),clock.instant(),bucket,stage,archived,page,size,platform,q,applicationStatus,null);
    }
    private Map<String,Object> listAt(long profile,Instant instant,Bucket bucket,String stage,boolean archived,int page,int size,String platform,String q,String applicationStatus,Long knownTotal) {
        int safePage=Math.max(1,Math.min(10001,page)),limit=Math.max(1,Math.min(100,size));
        var parameters=bucket==null?new ArrayList<Object>(List.of(profile)):args(profile,bucket,instant);
        String filter=" FROM facts WHERE "+(bucket==null?"1=1":condition(bucket))+" AND archived=?";parameters.add(archived?1:0);
        if(stage!=null&&!stage.isBlank()){filter+=" AND stage=?";parameters.add(OpportunityStage.valueOf(stage).name());}
        if(platform!=null&&!platform.isBlank()) {
            if(!Set.of("boss","zhilian","liepin","51job").contains(platform)) throw new IllegalArgumentException("平台筛选无效");
            filter+=" AND platform=?";parameters.add(platform);
        }
        if(applicationStatus!=null&&!applicationStatus.isBlank()) {
            if(!Set.of("NOT_REQUESTED","REQUESTED","CONFIRMED","FAILED","UNKNOWN").contains(applicationStatus)) throw new IllegalArgumentException("投递状态筛选无效");
            filter+=" AND application_status=?";parameters.add(applicationStatus);
        }
        if(q!=null&&!q.isBlank()) {
            String term=q.trim();if(term.length()>200) throw new IllegalArgumentException("搜索关键词最多 200 字");
            filter+=" AND instr(lower(COALESCE(job_name,'')||' '||COALESCE(company_name,'')),lower(?))>0";parameters.add(term);
        }
        long total=knownTotal!=null?knownTotal:jdbc.queryForObject(FACTS+"SELECT COUNT(*)"+filter,Long.class,parameters.toArray());
        parameters.add(limit);parameters.add((safePage-1)*limit);
        var items=jdbc.queryForList(FACTS+"SELECT id,platform,job_key,job_name,company_name,stage,interest,archived,follow_up_at,version,created_at,updated_at,application_status,match_score,"+
            "CASE WHEN json_valid(job_snapshot) THEN json_extract(job_snapshot,'$.salary') END AS salary,"+
            "CASE WHEN json_valid(job_snapshot) THEN json_extract(job_snapshot,'$.location') END AS location,"+
            interviewColumn(bucket,instant,"scheduled_at")+" AS interview_at,"+interviewColumn(bucket,instant,"timezone")+" AS interview_timezone,"+interviewColumn(bucket,instant,"round_number")+" AS interview_round,"+
            interviewColumn(bucket,instant,"json_array_length(i.preparation_json)")+" AS interview_prepared"+
            filter+" ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?",parameters.toArray());
        for(var item:items) item.put("task_summary",bucket==null?"":bucket.label);
        return Map.of("items",items,"total",total,"page",safePage,"size",limit,"bucket",bucket==null?"":bucket.name(),"scopeLabel",bucket==null?"全部机会":bucket.label,"profileId",profile);
    }
    private static String interviewColumn(Bucket bucket,Instant instant,String field) {
        String condition="i.status='SCHEDULED'";
        if(bucket==Bucket.INTERVIEW_PREPARE) condition+=" AND json_array_length(i.preparation_json)<4 AND julianday(i.scheduled_at)>=julianday('"+instant+"') AND julianday(i.scheduled_at)<julianday('"+instant.plus(Duration.ofDays(7))+"')";
        if(bucket==Bucket.INTERVIEW_CHECK) condition+=" AND julianday(i.scheduled_at)<julianday('"+instant+"')";
        if(bucket==Bucket.INTERVIEW_SCHEDULED) condition+=" AND julianday(i.scheduled_at)>=julianday('"+instant+"')";
        String column=field.startsWith("json_")?field:"i."+field;
        return "(SELECT "+column+" FROM interview i WHERE i.opportunity_id=facts.id AND i.profile_id=facts.profile_id AND "+condition+" ORDER BY i.scheduled_at,i.id LIMIT 1)";
    }
}
