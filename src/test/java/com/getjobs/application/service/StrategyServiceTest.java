package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class StrategyServiceTest {
    @TempDir Path directory;
    JdbcTemplate jdbc;ProfileService profiles;StrategyService service;StrategyDatasetService dataset;ObjectMapper json=new ObjectMapper();
    final Instant now=Instant.now();
    final Instant applied=now.minus(Duration.ofDays(40));
    @BeforeEach void setup() {
        var source=new DriverManagerDataSource("jdbc:sqlite:"+directory.resolve("strategy.db"));
        Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
        jdbc=new JdbcTemplate(source);jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'fixture',1),(2,'foreign',0)");
        profiles=mock(ProfileService.class);when(profiles.getCurrentProfileId()).thenReturn(1L);
        dataset=new StrategyDatasetService(jdbc,json);
        service=new StrategyService(jdbc,profiles,new DataSourceTransactionManager(source),dataset,json);
    }
    void event(long opportunity,String key,String type,String source,Instant time,Map<String,Object> payload) throws Exception {
        jdbc.update("INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,occurred_at,payload) VALUES(?,1,?,?,?,?,?)",opportunity,key,type,source,time==null?null:time.toString(),json.writeValueAsString(payload));
    }
    void application(long id,boolean legacy) throws Exception {
        jdbc.update("INSERT INTO opportunity(id,profile_id,platform,job_key,job_name) VALUES(?,1,'boss',?,'后改标题')",id,"job"+id);
        jdbc.update("INSERT INTO delivery_attempt(id,request_key,platform,profile_id,job_key,job_row_id,state,requested_at,updated_at,evidence) VALUES(?,?,'boss',1,?,?,'CONFIRMED',?,?,'USER_CONFIRMED')",id,"apply"+id,"job"+id,id,applied.toString(),applied.toString());
        // Synthetic historical timeline only; production events cannot be rewritten.
        jdbc.update("DELETE FROM opportunity_event WHERE opportunity_id=?",id);
        var payload=Map.<String,Object>of("attemptId",id,"historicalContextUnknown",legacy?1:0,"context",Map.of("jobSnapshot",Map.of("salary","15-25K","companyScale","100-499人")));
        event(id,"request"+id,"APPLICATION_REQUESTED",legacy?"LEGACY_IMPORT":"APPLICATION_SERVICE",legacy?null:applied,payload);
        event(id,"confirm"+id,"APPLICATION_CONFIRMED",legacy?"LEGACY_IMPORT":"APPLICATION_SERVICE",legacy?null:applied.plusSeconds(5),payload);
    }
    @Test void snapshotsRemainImmutableAndUnknownHistoryNeverBecomesNegativeOrCurrentResume() throws Exception {
        application(1,false);application(2,true);
        event(1,"keyword","SEARCH_DISCOVERY","COLLECTOR",applied.minusSeconds(1),Map.of("keyword","AI应用运营"));
        event(1,"reply","OUTCOME_RECRUITER_REPLIED","USER",applied.plus(Duration.ofDays(2)),Map.of("attemptId",1));
        var create=new StrategyService.Create(90,"stable");var first=service.create(create);
        long id=((Number)first.get("id")).longValue();
        var analysis=json.valueToTree(first).path("result").path("analysis");
        assertThat(analysis.path("applications").asInt()).isEqualTo(1);
        assertThat(analysis.path("reply").path("positive").asInt()).isEqualTo(1);
        assertThat(analysis.path("reply").path("confidence").asText()).isEqualTo("INSUFFICIENT_DATA");
        assertThat(analysis.path("reply").path("ratePercent").isNull()).isTrue();
        assertThat(analysis.path("interview").path("observed").asInt()).isZero();
        assertThat(analysis.path("groups").toString()).contains("实际发送版本未知");
        event(1,"late","OUTCOME_INTERVIEW_INVITED","USER",applied.plusSeconds(30),Map.of("attemptId",1));
        assertThat(service.create(create).get("result")).isEqualTo(first.get("result"));
        assertThatThrownBy(()->jdbc.update("UPDATE strategy_snapshot SET result_json='{}' WHERE id=?",id)).hasMessageContaining("不可重写");
        assertThatThrownBy(()->service.decide(id,new StrategyService.Decision(0,"invented","ADOPTED"))).hasMessageContaining("不属于");
        when(profiles.getCurrentProfileId()).thenReturn(2L);
        assertThatThrownBy(()->service.detail(id)).hasMessageContaining("不属于");
        assertThat(service.list().get("items")).isEqualTo(List.of());
    }
    @Test void correctionsAndUnknownOccurrencePreventFalseFeedbackLabels() throws Exception {
        application(1,false);
        event(1,"reply","OUTCOME_RECRUITER_REPLIED","USER",null,Map.of("attemptId",1));
        event(1,"checked","OUTCOME_NO_REPLY_OBSERVED","USER",null,Map.of("attemptId",1,"observedUntil",now.toString()));
        var input=dataset.read(1,now);
        assertThat(input.samples().getFirst().replyObservedUntil()).isNull();
        long corrected=jdbc.queryForObject("SELECT id FROM opportunity_event WHERE event_key='reply'",Long.class);
        jdbc.update("INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,correction_of) VALUES(1,1,'correction','CORRECTION','USER',?)",corrected);
        assertThat(dataset.read(1,now).samples().getFirst().replyObservedUntil()).isEqualTo(now);
    }
    @Test void newRequestFreezesTitleForLaterAttribution() {
        jdbc.update("INSERT INTO opportunity(id,profile_id,platform,job_key,job_name) VALUES(1,1,'boss','new','AI应用运营')");
        jdbc.update("INSERT INTO delivery_attempt(id,request_key,platform,profile_id,job_key,job_row_id,state,requested_at,updated_at,evidence) VALUES(1,'new','boss',1,'new',1,'REQUESTED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'USER_CONFIRMED')");
        jdbc.update("UPDATE opportunity SET job_name='开发工程师' WHERE id=1");
        jdbc.update("UPDATE delivery_attempt SET state='CONFIRMED' WHERE id=1");
        assertThat(dataset.read(1,Instant.now().plusSeconds(5)).samples().getFirst().dimensions()).containsEntry("ROLE","运营");
    }
    @Test void duplicateAttemptsAndExistingContactNeverBecomeNewApplications() throws Exception {
        application(1,false);application(2,false);
        jdbc.update("UPDATE delivery_attempt SET evidence='EXISTING_CONVERSATION' WHERE id=2");
        jdbc.update("INSERT INTO delivery_attempt(id,request_key,platform,profile_id,job_key,job_row_id,state,requested_at,updated_at,evidence) VALUES(3,'duplicate','boss',1,'job1',1,'CONFIRMED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'USER_CONFIRMED')");
        event(1,"search2","SEARCH_DISCOVERY","COLLECTOR",applied.minusSeconds(1),Map.of("keyword","later"));
        event(1,"search1","SEARCH_DISCOVERY","COLLECTOR",applied.minusSeconds(30),Map.of("keyword","first"));
        var result=dataset.read(1,now.plusSeconds(5));
        assertThat(result.samples()).hasSize(1);
        assertThat(result.samples().getFirst().dimensions()).containsEntry("KEYWORD","first");
        assertThat(result.exclusions()).containsEntry("同机会重复投递尝试",1).containsEntry("历史导入或此前已联系",1);
    }
    @Test void adoptedInsightIsOnlyAReviewAndItsHistorySurvivesChangingTheDecision() {
        var input=mock(StrategyDatasetService.class);
        var samples=new ArrayList<com.getjobs.application.strategy.StrategyAnalytics.Sample>();
        for(int i=1;i<=40;i++) samples.add(new com.getjobs.application.strategy.StrategyAnalytics.Sample(i,applied,Map.of("KEYWORD",i<=20?"A":"B"),i<=15?applied.plusSeconds(100):null,now,null,null));
        when(input.read(eq(1L),any())).thenReturn(new StrategyDatasetService.Dataset(samples,Map.of(),0,0));
        var review=new StrategyService(jdbc,profiles,new DataSourceTransactionManager(jdbc.getDataSource()),input,json);
        var snapshot=review.create(new StrategyService.Create(90,"review"));long id=((Number)snapshot.get("id")).longValue();
        var adopted=review.decide(id,new StrategyService.Decision(0,"KEYWORD:A","ADOPTED"));
        assertThat(json.valueToTree(adopted).path("decisions").path("KEYWORD:A").path("history").size()).isEqualTo(1);
        review.decide(id,new StrategyService.Decision(0,"KEYWORD:A","ADOPTED"));
        var ignored=review.decide(id,new StrategyService.Decision(1,"KEYWORD:A","IGNORED"));
        assertThat(json.valueToTree(ignored).path("decisions").path("KEYWORD:A").path("history").size()).isEqualTo(2);
        assertThat(ignored.get("result")).isEqualTo(snapshot.get("result"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM delivery_attempt",Integer.class)).isZero();
    }
}
