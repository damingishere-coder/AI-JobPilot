package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import java.util.Map;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class OpportunityServiceTest {
    @TempDir Path directory;
    JdbcTemplate jdbc;
    OpportunityService service;
    DeliveryAttemptService attempts;
    ProfileService profiles;
    DriverManagerDataSource dataSource;

    @BeforeEach void setup() {
        dataSource=new DriverManagerDataSource("jdbc:sqlite:"+directory.resolve("opportunity.db"));
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();
        jdbc=new JdbcTemplate(dataSource);
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'fixture',1),(2,'other',0)");
        profiles=mock(ProfileService.class); when(profiles.getCurrentProfileId()).thenReturn(1L);
        service=new OpportunityService(jdbc,new DataSourceTransactionManager(dataSource),profiles,new HrAssistantCryptoService(directory.resolve("fixture.key")),new ObjectMapper());
        attempts=new DeliveryAttemptService(jdbc,new DataSourceTransactionManager(dataSource));
        jdbc.update("INSERT INTO zhilian_data(id,profile_id,job_id,job_title,delivery_status) VALUES(10,1,'job-a','合成岗位','待确认')");
    }
    long id() { return jdbc.queryForObject("SELECT id FROM opportunity WHERE job_key='job-a'",Long.class); }
    long version() { return jdbc.queryForObject("SELECT version FROM opportunity WHERE id=?",Long.class,id()); }
    OpportunityService.Change command(String key,String stage,Boolean archived) {
        return new OpportunityService.Change(version(),key,stage,null,"PRIVATE-NOTE",null,null,archived,null,null,null);
    }
    @Test void rescanPreservesInterestStageNotesAndArchiveWithoutDuplicatingIdentity() {
        var change=new OpportunityService.Change(version(),"like",null,"INTERESTED","PRIVATE-NOTE","next",null,null,null,null,null);
        service.change(id(),change);
        service.change(id(),command("archive",null,true));
        jdbc.update("UPDATE zhilian_data SET job_title='updated' WHERE id=10");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity",Integer.class)).isEqualTo(1);
        assertThat(service.detail(id())).containsEntry("stage","SHORTLISTED").containsEntry("interest","INTERESTED").containsEntry("archived",1).containsEntry("note","PRIVATE-NOTE");
        assertThat(jdbc.queryForObject("SELECT note_cipher FROM opportunity",String.class)).doesNotContain("PRIVATE-NOTE");
        assertThat(service.list(null,false,1,20)).containsEntry("total",0L);
        assertThat(attempts.requestZhilian(10,1,"job-a").created()).isFalse();
        service.change(id(),command("restore",null,false));
        assertThat(service.list(null,false,1,20)).containsEntry("total",1L);
        assertThat(attempts.requestZhilian(10,1,"job-a").created()).isTrue();
    }
    @Test void userCommandsAreIdempotentVersionedAndCorrectionsAreAppendOnly() {
        var first=command("update","INTERVIEW",null);
        service.change(id(),first);
        assertThat(service.change(id(),first)).containsEntry("duplicate",true);
        assertThatThrownBy(()->service.change(id(),command("update","OFFER",null))).hasMessageContaining("不同内容");
        assertThatThrownBy(()->service.change(id(),new OpportunityService.Change(0,"stale",null,null,null,null,null,null,null,null,null))).hasMessageContaining("刷新");
        assertThatThrownBy(()->service.change(id(),command("back","DISCOVERED",null))).isInstanceOf(IllegalArgumentException.class);
        long event=jdbc.queryForObject("SELECT id FROM opportunity_event WHERE event_key='user:update'",Long.class);
        service.change(id(),new OpportunityService.Change(version(),"correct","DISCOVERED",null,null,null,null,null,null,event,"录入错误"));
        assertThat(service.detail(id())).containsEntry("stage","DISCOVERED");
        assertThatThrownBy(()->jdbc.update("UPDATE opportunity_event SET type='FAKE' WHERE id=?",event)).hasMessageContaining("只能追加");
        when(profiles.getCurrentProfileId()).thenReturn(2L);
        assertThatThrownBy(()->service.detail(id())).hasMessageContaining("不属于");
        assertThatThrownBy(()->service.change(id(),command("foreign",null,null))).hasMessageContaining("不属于");
    }
    @Test void unknownDoesNotAdvanceAndDuplicateOrLateCallbackCannotRegressStage() {
        var requested=attempts.requestZhilian(10,1,"job-a");
        attempts.resolve("zhilian",1L,10,requested.requestKey(),DeliveryAttemptService.State.UNKNOWN,DeliveryAttemptService.NO_CONFIRMATION,"fixture",null,null);
        assertThat(service.detail(id())).containsEntry("stage","DISCOVERED");
        assertThatThrownBy(()->service.change(id(),command("archive-unknown",null,true))).hasMessageContaining("UNKNOWN");
        service.change(id(),command("interview","INTERVIEW",null));
        var accepted=attempts.resolve("zhilian",1L,10,requested.requestKey(),DeliveryAttemptService.State.CONFIRMED,DeliveryAttemptService.PLATFORM_STATUS_TEXT,"已申请",null,null);
        assertThat(accepted.accepted()).isTrue();
        attempts.resolve("zhilian",1L,10,requested.requestKey(),DeliveryAttemptService.State.CONFIRMED,DeliveryAttemptService.PLATFORM_STATUS_TEXT,"已申请",null,null);
        assertThat(service.detail(id())).containsEntry("stage","INTERVIEW");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE type='APPLICATION_CONFIRMED'",Integer.class)).isEqualTo(1);
    }
    @Test void transactionFailureCannotLeaveAttemptWithoutProjectionAndEvent() {
        var requested=attempts.requestZhilian(10,1,"job-a");
        jdbc.execute("CREATE TRIGGER fail_event BEFORE INSERT ON opportunity_event WHEN NEW.type='APPLICATION_CONFIRMED' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
        assertThatThrownBy(()->attempts.resolve("zhilian",1L,10,requested.requestKey(),DeliveryAttemptService.State.CONFIRMED,DeliveryAttemptService.PLATFORM_STATUS_TEXT,"已申请",null,null)).hasMessageContaining("fixture failure");
        assertThat(jdbc.queryForObject("SELECT state FROM delivery_attempt",String.class)).isEqualTo("REQUESTED");
        assertThat(jdbc.queryForObject("SELECT delivery_status FROM zhilian_data",String.class)).isEqualTo(DeliveryStatus.DELIVERY_REQUESTED);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE type='APPLICATION_CONFIRMED'",Integer.class)).isZero();
    }
    @Test void aiRecommendationNeverBecomesUserInterestAndRequestKeepsAnalysisAtConfirmation() {
        jdbc.update("INSERT INTO job_ai_analysis(profile_id,platform,job_key,score,decision) VALUES(1,'zhilian','job-a',95,'待确认')");
        long first=jdbc.queryForObject("SELECT MAX(id) FROM job_ai_analysis",Long.class);
        assertThat(service.detail(id())).containsEntry("stage","DISCOVERED").containsEntry("interest","UNDECIDED");
        var request=attempts.requestZhilian(10,1,"job-a");
        jdbc.update("INSERT INTO job_ai_analysis(profile_id,platform,job_key,score,decision) VALUES(1,'zhilian','job-a',40,'AI不匹配')");
        attempts.resolve("zhilian",1L,10,request.requestKey(),DeliveryAttemptService.State.CONFIRMED,DeliveryAttemptService.PLATFORM_STATUS_TEXT,"已申请",null,null);
        assertThat(jdbc.queryForObject("SELECT json_extract(payload,'$.context.analysisId') FROM opportunity_event WHERE type='APPLICATION_CONFIRMED'",Long.class)).isEqualTo(first);
        assertThatThrownBy(()->jdbc.update("DELETE FROM job_ai_analysis WHERE id=?",first)).hasMessageContaining("求职历史");
        assertThatThrownBy(()->jdbc.update("DELETE FROM zhilian_data WHERE id=10")).hasMessageContaining("求职历史");
    }
}
