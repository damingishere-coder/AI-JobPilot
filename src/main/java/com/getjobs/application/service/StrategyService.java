package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.getjobs.application.strategy.StrategyAnalytics;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Instant;
import java.util.*;

@Service
@RequiredArgsConstructor
public class StrategyService {
    private final JdbcTemplate jdbc;
    private final ProfileService profiles;
    private final PlatformTransactionManager transactions;
    private final StrategyDatasetService dataset;
    private final ObjectMapper json;
    public Map<String,Object> list() {
        long profile=profiles.getCurrentProfileId();
        return Map.of("profileId",profile,"items",jdbc.queryForList("SELECT id,window_days,cutoff,rule_version,version FROM strategy_snapshot WHERE profile_id=? ORDER BY id DESC LIMIT 20",profile));
    }
    public Map<String,Object> detail(long id) { return decode(owned(id,profiles.getCurrentProfileId())); }
    public Map<String,Object> create(Create request) {
        if(request==null||!Set.of(30,90).contains(request.windowDays())) throw new IllegalArgumentException("统计窗口只支持 30 或 90 天");
        key(request.requestKey());
        long profile=profiles.getCurrentProfileId();
        return new TransactionTemplate(transactions).execute(status->{
            jdbc.update("UPDATE strategy_snapshot SET version=version WHERE id=-1");
            var existing=jdbc.queryForList("SELECT * FROM strategy_snapshot WHERE profile_id=? AND request_key=?",profile,request.requestKey());
            if(!existing.isEmpty()) {
                if(((Number)existing.getFirst().get("window_days")).intValue()!=request.windowDays()) throw new IllegalArgumentException("该操作标识已用于其他统计窗口");
                return decode(existing.getFirst());
            }
            Instant cutoff=Instant.now();var input=dataset.read(profile,cutoff);
            var analysis=StrategyAnalytics.calculate(input.samples(),cutoff,request.windowDays());
            String result=write(Map.of("analysis",analysis,"exclusions",input.exclusions(),"interviewRecords",input.interviewRecords(),"minimumSample",StrategyAnalytics.MINIMUM_SAMPLE));
            long id=jdbc.queryForObject("INSERT INTO strategy_snapshot(profile_id,request_key,window_days,cutoff,through_event_id,rule_version,result_json) VALUES(?,?,?,?,?,?,?) RETURNING id",Long.class,
                profile,request.requestKey(),request.windowDays(),cutoff.toString(),input.throughEventId(),StrategyAnalytics.RULE_VERSION,result);
            return decode(owned(id,profile));
        });
    }
    public Map<String,Object> decide(long id,Decision request) {
        if(request==null||request.insightId()==null||request.insightId().length()>1000||!Set.of("ADOPTED","IGNORED").contains(Objects.toString(request.decision(),""))) throw new IllegalArgumentException("策略审阅操作无效");
        return new TransactionTemplate(transactions).execute(status->{
            jdbc.update("UPDATE strategy_snapshot SET version=version WHERE id=-1");
            var row=owned(id,profiles.getCurrentProfileId());
            JsonNode insights=parse((String)row.get("result_json")).path("analysis").path("insights");
            boolean found=false;for(var insight:insights) if(insight.path("id").asText().equals(request.insightId())) found=true;
            if(!found) throw new IllegalArgumentException("结论不属于该策略快照");
            ObjectNode decisions=(ObjectNode)parse((String)row.get("decisions_json"));
            if(decisions.path(request.insightId()).path("decision").asText().equals(request.decision())) return decode(row);
            if(((Number)row.get("version")).longValue()!=request.version()) throw new IllegalStateException("策略已更新，请刷新后审阅");
            // Append all review actions for the insight; no search/ranking/application side effects.
            var previous=decisions.path(request.insightId());
            var history=previous.path("history").isArray()?previous.path("history").deepCopy():json.createArrayNode();
            ((com.fasterxml.jackson.databind.node.ArrayNode)history).add(json.valueToTree(Map.of("decision",request.decision(),"at",Instant.now().toString())));
            ObjectNode next=json.createObjectNode();next.put("decision",request.decision());next.set("history",history);decisions.set(request.insightId(),next);
            jdbc.update("UPDATE strategy_snapshot SET decisions_json=?,version=version+1 WHERE id=?",write(decisions),id);
            return decode(owned(id,profiles.getCurrentProfileId()));
        });
    }
    private Map<String,Object> owned(long id,long profile) {
        var rows=jdbc.queryForList("SELECT * FROM strategy_snapshot WHERE id=? AND profile_id=?",id,profile);
        if(rows.isEmpty()) throw new IllegalArgumentException("策略快照不存在或不属于当前档案");return rows.getFirst();
    }
    private Map<String,Object> decode(Map<String,Object> row) { row.put("result",parse((String)row.remove("result_json")));row.put("decisions",parse((String)row.remove("decisions_json")));row.remove("request_key");return row; }
    private void key(String value) { if(value==null||!value.matches("[A-Za-z0-9:_-]{1,100}")) throw new IllegalArgumentException("缺少有效操作标识"); }
    private String write(Object value) { try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalStateException("策略快照格式无效",e);} }
    private JsonNode parse(String value) { try{return json.readTree(value);}catch(Exception e){throw new IllegalStateException("策略快照无法读取",e);} }
    public record Create(int windowDays,String requestKey) {}
    public record Decision(long version,String insightId,String decision) {}
}
