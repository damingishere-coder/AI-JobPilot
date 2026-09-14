package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.strategy.StrategyAnalytics;
import com.getjobs.application.strategy.StrategyDimensions;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.time.*;
import java.util.*;

/** Converts confirmed application and human outcome facts to a bounded, reproducible cohort. */
@Service
@RequiredArgsConstructor
public class StrategyDatasetService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private static final Set<String> REPLY_TYPES=Set.of("OUTCOME_RECRUITER_REPLIED","OUTCOME_CHATTING","OUTCOME_PHONE_SCREEN","OUTCOME_INTERVIEW_INVITED","OUTCOME_OFFER","OUTCOME_REJECTED");
    public record Dataset(List<StrategyAnalytics.Sample> samples,Map<String,Integer> exclusions,long throughEventId,int interviewRecords) {}
    record Event(long id,long opportunityId,String type,String source,Instant occurred,JsonNode payload,Long correctionOf) {}

    public Dataset read(long profile,Instant cutoff) {
        long through=jdbc.queryForObject("SELECT COALESCE(MAX(id),0) FROM opportunity_event WHERE profile_id=?",Long.class,profile);
        var rows=jdbc.queryForList("SELECT id,opportunity_id,type,source,occurred_at,payload,correction_of FROM opportunity_event WHERE profile_id=? AND id<=? ORDER BY id LIMIT 100001",profile,through);
        if(rows.size()>100000) throw new IllegalStateException("当前反馈超过单次统计上限，请分段归档统计后再生成；未截断或忽略样本");
        List<Event> events=new ArrayList<>();
        for(var row:rows) events.add(new Event(number(row.get("id")),number(row.get("opportunity_id")),(String)row.get("type"),(String)row.get("source"),time((String)row.get("occurred_at")),parse((String)row.get("payload")),row.get("correction_of")==null?null:number(row.get("correction_of"))));
        Set<Long> corrected=new HashSet<>();events.stream().filter(e->e.correctionOf()!=null).forEach(e->corrected.add(e.correctionOf()));
        Map<Long,List<Event>> byOpportunity=new HashMap<>();
        events.stream().filter(e->!corrected.contains(e.id())).forEach(e->byOpportunity.computeIfAbsent(e.opportunityId(),k->new ArrayList<>()).add(e));
        var attempts=jdbc.queryForList("""
            SELECT a.id,a.state,a.evidence,o.id AS opportunity_id,o.platform,o.job_name,
              EXISTS(SELECT 1 FROM runtime_event r WHERE r.attempt_id=a.id AND r.evidence IN('ALREADY_APPLIED','ALREADY_CONTACTED')) AS existing_effect
            FROM delivery_attempt a JOIN opportunity o ON o.profile_id=a.profile_id AND o.platform=a.platform AND o.job_key=a.job_key
            WHERE a.profile_id=? ORDER BY a.id
            """,profile);
        Map<Long,Integer> scores=new HashMap<>();
        for(var row:jdbc.queryForList("SELECT id,score FROM job_ai_analysis WHERE profile_id=?",profile)) scores.put(number(row.get("id")),row.get("score")==null?null:((Number)row.get("score")).intValue());
        List<StrategyAnalytics.Sample> samples=new ArrayList<>();Map<String,Integer> exclusions=new TreeMap<>();Set<Long> seen=new HashSet<>();
        for(var attempt:attempts) {
            long opportunity=number(attempt.get("opportunity_id")),attemptId=number(attempt.get("id"));
            if(!"CONFIRMED".equals(attempt.get("state"))) { increment(exclusions,"未确认投递尝试");continue; }
            if(!seen.add(opportunity)) { increment(exclusions,"同机会重复投递尝试");continue; }
            if(Set.of("EXISTING_CONVERSATION","LEGACY_STATUS_IMPORT").contains(Objects.toString(attempt.get("evidence"),""))||number(attempt.get("existing_effect"))==1) { increment(exclusions,"历史导入或此前已联系");continue; }
            var scoped=byOpportunity.getOrDefault(opportunity,List.of());
            Event requested=find(scoped,"APPLICATION_REQUESTED",attemptId),confirmed=find(scoped,"APPLICATION_CONFIRMED",attemptId);
            if(requested==null||confirmed==null||!"APPLICATION_SERVICE".equals(confirmed.source())||requested.occurred()==null||requested.occurred().isAfter(cutoff)||confirmed.occurred()==null||confirmed.occurred().isAfter(cutoff)||confirmed.payload().path("historicalContextUnknown").asInt(1)!=0) {
                increment(exclusions,"历史时间或输入上下文未知");continue;
            }
            JsonNode context=requested.payload().path("context"),job=context.path("jobSnapshot");
            Map<String,String> dimensions=new TreeMap<>();
            dimensions.put("PLATFORM",Objects.toString(attempt.get("platform"),"未知"));
            // Titles are taken from the frozen request context; never current re-scan content.
            Event attribution=find(scoped,"APPLICATION_ATTRIBUTION",attemptId);
            dimensions.put("ROLE",StrategyDimensions.role(attribution==null?null:attribution.payload().path("jobTitle").asText(null)));
            dimensions.put("SALARY",StrategyDimensions.salary(text(job,"salary")));
            dimensions.put("COMPANY_SCALE",orUnknown(text(job,"companyScale","scale")));
            dimensions.put("SCORE",StrategyDimensions.score(scores.get(context.path("analysisId").asLong(-1))));
            dimensions.put("KEYWORD",scoped.stream().filter(e->e.type().equals("SEARCH_DISCOVERY")&&e.occurred()!=null&&!e.occurred().isAfter(requested.occurred()))
                .min(Comparator.comparing(Event::occurred).thenComparingLong(Event::id)).map(e->orUnknown(e.payload().path("keyword").asText(null))).orElse("未知"));
            var outcomes=scoped.stream().filter(e->e.source().equals("USER")&&e.type().startsWith("OUTCOME_")&&e.payload().path("attemptId").asLong(-1)==attemptId).toList();
            Set<Long> versions=new HashSet<>();outcomes.stream().filter(e->e.payload().path("actualSentResumeVersionId").isIntegralNumber()).forEach(e->versions.add(e.payload().path("actualSentResumeVersionId").asLong()));
            dimensions.put("RESUME",versions.size()==1?"实际发送版本 #"+versions.iterator().next():"实际发送版本未知");
            Instant reply=earliest(outcomes,REPLY_TYPES,requested.occurred(),cutoff);
            Instant interview=earliest(outcomes,Set.of("OUTCOME_INTERVIEW_INVITED"),requested.occurred(),cutoff);
            Instant replyObserved=observed(outcomes,"OUTCOME_NO_REPLY_OBSERVED",cutoff),interviewObserved=observed(outcomes,"OUTCOME_NO_INTERVIEW_OBSERVED",cutoff);
            // An outcome with unknown occurrence time must not be turned into a negative by a later check.
            if(outcomes.stream().anyMatch(e->REPLY_TYPES.contains(e.type())&&e.occurred()==null)) replyObserved=null;
            if(outcomes.stream().anyMatch(e->e.type().equals("OUTCOME_INTERVIEW_INVITED")&&e.occurred()==null)) interviewObserved=null;
            samples.add(new StrategyAnalytics.Sample(opportunity,requested.occurred(),dimensions,reply,replyObserved,interview,interviewObserved));
        }
        int records=jdbc.queryForObject("SELECT COUNT(*) FROM interview WHERE profile_id=?",Integer.class,profile);
        return new Dataset(samples,exclusions,through,records);
    }
    private Event find(List<Event> events,String type,long attempt) { return events.stream().filter(e->e.type().equals(type)&&e.payload().path("attemptId").asLong(-1)==attempt).findFirst().orElse(null); }
    private Instant earliest(List<Event> events,Set<String> types,Instant start,Instant cutoff) { return events.stream().filter(e->types.contains(e.type())&&e.occurred()!=null&&!e.occurred().isBefore(start)&&!e.occurred().isAfter(cutoff)).map(Event::occurred).min(Comparator.naturalOrder()).orElse(null); }
    private Instant observed(List<Event> events,String type,Instant cutoff) { return events.stream().filter(e->e.type().equals(type)).map(e->time(e.payload().path("observedUntil").asText(null))).filter(Objects::nonNull).filter(t->!t.isAfter(cutoff)).max(Comparator.naturalOrder()).orElse(null); }
    private long number(Object value) { return ((Number)value).longValue(); }
    private String text(JsonNode value,String...keys) { for(String key:keys) if(value.path(key).isTextual()&&!value.path(key).asText().isBlank()) return value.path(key).asText();return null; }
    private String orUnknown(String value) { return value==null||value.isBlank()?"未知":value; }
    private JsonNode parse(String raw) { try { return json.readTree(raw==null?"{}":raw); } catch(Exception e) { throw new IllegalStateException("历史反馈格式无效，统计已停止，请先核对数据",e); } }
    private static Instant time(String value) { if(value==null||value.isBlank()) return null;try { return Instant.parse(value.contains("T")?value:value.replace(' ','T')+"Z"); } catch(Exception e) { return null; } }
    private void increment(Map<String,Integer> values,String key) { values.merge(key,1,Integer::sum); }
}
