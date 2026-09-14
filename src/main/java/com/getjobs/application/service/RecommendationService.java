package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.strategy.*;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.*;
import java.util.*;

@Service
@RequiredArgsConstructor
public class RecommendationService {
    private final JdbcTemplate jdbc;
    private final ProfileService profiles;
    private final PlatformTransactionManager transactions;
    private final HrAssistantCryptoService crypto;
    private final ObjectMapper json;
    public record Settings(long profileId,long version,boolean enabled,PreferenceMatcher.Preferences preferences) {}
    public record Save(long profileId,long version,boolean enabled,PreferenceMatcher.Preferences preferences) {}
    public record Preview(long profileId,PreferenceMatcher.Preferences preferences) {}

    public Settings settings() { return settings(profiles.getCurrentProfileId()); }
    private Settings settings(long profile) {
        var rows=config(profile);
        if(rows.isEmpty()) return new Settings(profile,0,false,PreferenceMatcher.normalize(null));
        var row=rows.getFirst();return new Settings(profile,number(row.get("preference_version")),number(row.get("ranking_enabled"))==1,preferences((String)row.get("preference_json")));
    }
    private List<Map<String,Object>> config(long profile) { return jdbc.queryForList("SELECT id,preference_version,preference_json,ranking_enabled FROM ai WHERE profile_id=? ORDER BY id DESC LIMIT 1",profile); }
    public Settings save(Save request) {
        if(request==null) throw new IllegalArgumentException("缺少偏好设置");
        var normalized=PreferenceMatcher.normalize(request.preferences());long profile=profiles.getCurrentProfileId();
        if(profile!=request.profileId()) throw new IllegalArgumentException("档案已改变，请刷新后保存偏好");
        return new TransactionTemplate(transactions).execute(status->{
            jdbc.update("UPDATE ai SET preference_version=preference_version WHERE id=-1");
            var current=settings(profile);
            if(current.preferences().equals(normalized)&&current.enabled()==request.enabled()) return current;
            if(current.version()!=request.version()) throw new IllegalStateException("偏好已更新，请刷新后核对");
            var rows=config(profile);
            if(rows.isEmpty()) jdbc.update("INSERT INTO ai(profile_id,introduce,prompt,apply_threshold,priority_apply_threshold,preference_json,preference_version,ranking_enabled) VALUES(?,'','',?,?,?,1,?)",profile,JobAiAnalysisService.DEFAULT_APPLY_THRESHOLD,JobAiAnalysisService.DEFAULT_PRIORITY_APPLY_THRESHOLD,write(normalized),request.enabled()?1:0);
            else jdbc.update("UPDATE ai SET preference_json=?,preference_version=preference_version+1,ranking_enabled=? WHERE id=? AND profile_id=? AND preference_version=?",write(normalized),request.enabled()?1:0,rows.getFirst().get("id"),profile,request.version());
            return settings(profile);
        });
    }
    public Map<String,Object> recommendations() { var settings=settings();return rank(settings,settings.enabled()); }
    public Map<String,Object> preview(Preview request) {
        if(request==null||request.profileId()!=profiles.getCurrentProfileId()) throw new IllegalArgumentException("档案已改变，请刷新后预览");
        var current=settings();return rank(new Settings(current.profileId(),current.version(),current.enabled(),PreferenceMatcher.normalize(request.preferences())),true);
    }
    private Map<String,Object> rank(Settings settings,boolean useStrategy) {
        var rows=jdbc.queryForList("""
            SELECT o.id,o.platform,o.job_key,o.job_name,o.company_name,o.job_snapshot,a.id AS analysis_id,a.score,a.evaluated_result_cipher,
              CASE WHEN o.platform='boss' THEN (SELECT b.industry FROM boss_data b WHERE b.id=o.source_row_id AND b.profile_id=o.profile_id AND b.encrypt_id=o.job_key) ELSE NULL END AS industry,
              (SELECT json_extract(e.payload,'$.keyword') FROM opportunity_event e WHERE e.opportunity_id=o.id AND e.type='SEARCH_DISCOVERY' AND e.occurred_at IS NOT NULL ORDER BY julianday(e.occurred_at),e.id LIMIT 1) AS keyword
            FROM opportunity o LEFT JOIN job_ai_analysis a ON a.id=(SELECT j.id FROM job_ai_analysis j WHERE j.profile_id=o.profile_id AND j.platform=o.platform AND j.job_key=o.job_key ORDER BY j.id DESC LIMIT 1)
            WHERE o.profile_id=? AND o.archived=0 AND o.stage IN('DISCOVERED','SHORTLISTED') AND o.interest<>'NOT_INTERESTED'
              AND NOT EXISTS(SELECT 1 FROM delivery_attempt d WHERE d.profile_id=o.profile_id AND d.platform=o.platform AND d.job_key=o.job_key AND d.state IN('REQUESTED','UNKNOWN','CONFIRMED'))
            ORDER BY o.id LIMIT 10001
            """,settings.profileId());
        if(rows.size()>10000) throw new IllegalStateException("当前候选超过一万个，请先整理候选范围；没有截断后冒充全量排序");
        var snapshots=jdbc.queryForList("SELECT id,cutoff,result_json FROM strategy_snapshot WHERE profile_id=? ORDER BY id DESC LIMIT 1",settings.profileId());
        Long snapshotId=null;JsonNode feedback=null;String feedbackState="INSUFFICIENT_DATA";
        if(!snapshots.isEmpty()) {
            var snapshot=snapshots.getFirst();snapshotId=number(snapshot.get("id"));Instant cutoff=Instant.parse((String)snapshot.get("cutoff"));
            if(cutoff.isAfter(Instant.now())||cutoff.isBefore(Instant.now().minus(Duration.ofDays(30)))) feedbackState="STALE_DATA";
            else {feedback=parse((String)snapshot.get("result_json"));feedbackState="LOW_CONFIDENCE";}
        }
        List<RecommendationRanking.Candidate> candidates=new ArrayList<>();Map<Long,Map<String,Object>> displays=new HashMap<>();
        for(var row:rows) {
            long id=number(row.get("id"));JsonNode job=parse((String)row.get("job_snapshot")),evaluated=null;
            if(row.get("evaluated_result_cipher") instanceof String cipher&&!cipher.isBlank()) {
                evaluated=parse(crypto.decrypt(cipher,AnalysisContextService.evaluatedResultAad(settings.profileId(),(String)row.get("platform"),(String)row.get("job_key"))));
            }
            var fit=RecommendationRanking.fit(evaluated);
            var preference=PreferenceMatcher.match(settings.preferences(),new PreferenceMatcher.Fact((String)row.get("job_name"),text(job,"location"),text(job,"companyScale"),(String)row.get("industry"),null,text(job,"salary")));
            Map<String,String> dimensions=new HashMap<>();dimensions.put("KEYWORD",Objects.toString(row.get("keyword"),"未知"));dimensions.put("ROLE",StrategyDimensions.role((String)row.get("job_name")));dimensions.put("COMPANY_SCALE",Objects.toString(text(job,"companyScale"),"未知"));dimensions.put("SALARY",StrategyDimensions.salary(text(job,"salary")));
            var signal=RecommendationRanking.signal(feedback,dimensions);
            Integer score=row.get("score")==null?null:((Number)row.get("score")).intValue();
            candidates.add(new RecommendationRanking.Candidate(id,score,fit,preference,signal));
            var display=new LinkedHashMap<String,Object>();display.put("id",id);display.put("platform",row.get("platform"));display.put("jobName",row.get("job_name"));display.put("companyName",row.get("company_name"));
            display.put("legacyScore",score);display.put("analysisId",row.get("analysis_id"));display.put("fit",fit);display.put("preference",preference);display.put("signal",signal);display.put("feedbackState",feedbackState);
            displays.put(id,display);
        }
        var baseline=RecommendationRanking.sort(candidates,false);var ranked=RecommendationRanking.sort(candidates,useStrategy);var positions=new HashMap<Long,Integer>();for(int i=0;i<baseline.size();i++) positions.put(baseline.get(i),i+1);
        List<Map<String,Object>> items=new ArrayList<>();for(int i=0;i<ranked.size();i++){var item=displays.get(ranked.get(i));item.put("oldPosition",positions.get(ranked.get(i)));item.put("position",i+1);items.add(item);}
        var result=new LinkedHashMap<String,Object>();result.put("profileId",settings.profileId());result.put("preferenceVersion",settings.version());result.put("enabled",settings.enabled());result.put("strategyOrder",useStrategy);result.put("snapshotId",snapshotId);result.put("feedbackState",feedbackState);result.put("items",items);result.put("ruleVersion","preference-fit-band-feedback-v1");return result;
    }
    private PreferenceMatcher.Preferences preferences(String value) { try{return PreferenceMatcher.normalize(json.readValue(value,PreferenceMatcher.Preferences.class));}catch(Exception e){throw new IllegalStateException("偏好设置无法读取，请先核对",e);} }
    private JsonNode parse(String value) { try{var node=json.readTree(value==null?"{}":value);if(node==null) throw new IllegalStateException("数据为空");return node;}catch(Exception e){throw new IllegalStateException("排序依据无法读取，已停止使用该数据",e);} }
    private String text(JsonNode node,String key) { return node.path(key).isTextual()?node.path(key).asText():null; }
    private long number(Object value) { return ((Number)value).longValue(); }
    private String write(Object value) { try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalArgumentException("偏好格式无效",e);} }
}
