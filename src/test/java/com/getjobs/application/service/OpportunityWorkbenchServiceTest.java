package com.getjobs.application.service;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import java.time.*;
import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class OpportunityWorkbenchServiceTest {
    @TempDir Path directory;
    @Test void everyCardDrillsIntoTheSameScopeAndLegacyImportIsNotTodaysDiscovery() {
        var source=new DriverManagerDataSource("jdbc:sqlite:"+directory.resolve("workbench.db"));
        Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
        var jdbc=new JdbcTemplate(source);
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'fixture',1),(2,'other',0)");
        jdbc.update("INSERT INTO boss_data(id,profile_id,encrypt_id,delivery_status) VALUES(1,1,'unknown','投递结果待确认'),(2,1,'applied','已投递'),(3,1,'new','待确认'),(4,1,'legacy','待确认'),(5,2,'foreign','待确认')");
        jdbc.update("INSERT INTO delivery_attempt(request_key,platform,profile_id,job_key,job_row_id,state,requested_at,updated_at) VALUES('a','boss',1,'unknown',1,'UNKNOWN',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('b','boss',1,'applied',2,'CONFIRMED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        jdbc.update("UPDATE opportunity SET created_at='2026-09-13 16:30:00'");
        jdbc.update("UPDATE opportunity SET origin='LEGACY_IMPORT' WHERE job_key='legacy'");
        jdbc.update("UPDATE opportunity SET follow_up_at='2026-09-14T00:00:00Z' WHERE job_key='applied'");
        var profiles=mock(ProfileService.class);when(profiles.getCurrentProfileId()).thenReturn(1L);
        var service=new OpportunityWorkbenchService(jdbc,profiles,Clock.fixed(Instant.parse("2026-09-14T02:00:00Z"),ZoneOffset.UTC));
        var summary=service.summary();
        @SuppressWarnings("unchecked") var counts=(List<Map<String,Object>>)summary.get("counts");
        for(var row:counts) assertThat(service.list((String)row.get("bucket"),null,false,1,100).get("total")).isEqualTo(row.get("count"));
        assertThat(service.list("DISCOVERED_TODAY",null,false,1,20)).containsEntry("total",3L);
        assertThat(service.list("UNKNOWN",null,false,1,20)).containsEntry("total",1L);
        assertThat(service.list("AWAITING_REPLY",null,false,1,20)).containsEntry("total",1L);
        assertThat(service.list("FOLLOW_UP",null,false,1,20)).containsEntry("total",1L);
        assertThatThrownBy(()->service.list("UNKNOWN' OR 1=1",null,false,1,20)).isInstanceOf(IllegalArgumentException.class);
        jdbc.update("UPDATE opportunity SET archived=1 WHERE job_key='unknown'");
        assertThat(service.list("UNKNOWN",null,false,1,20)).containsEntry("total",0L);
        assertThat(service.list("UNKNOWN",null,true,1,20)).containsEntry("total",1L);
    }
    @Test void reviewingKnownMessagesDoesNotHideLaterMessagesOrConfirmRecruitingResults() {
        var source=new DriverManagerDataSource("jdbc:sqlite:"+directory.resolve("review.db"));
        Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
        var jdbc=new JdbcTemplate(source);
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'fixture',1)");
        jdbc.update("INSERT INTO opportunity(id,profile_id,platform,job_key) VALUES(1,1,'boss','fixture')");
        jdbc.update("INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,payload) VALUES(1,1,'message1','HR_INBOUND_OBSERVED','HR_OBSERVATION','{\"conversationId\":7}')");
        long through=jdbc.queryForObject("SELECT MAX(id) FROM opportunity_event",Long.class);
        var profiles=mock(ProfileService.class);when(profiles.getCurrentProfileId()).thenReturn(1L);
        var workbench=new OpportunityWorkbenchService(jdbc,profiles);
        var opportunities=new OpportunityService(jdbc,new DataSourceTransactionManager(source),profiles,new HrAssistantCryptoService(directory.resolve("fixture.key")),new ObjectMapper());
        assertThat(workbench.list("HR_REVIEW",null,false,1,20)).containsEntry("total",1L);
        var request=new OpportunityService.ObservationReview(0,through);
        opportunities.reviewObservations(1,request); opportunities.reviewObservations(1,request);
        assertThat(workbench.list("HR_REVIEW",null,false,1,20)).containsEntry("total",0L);
        assertThat(jdbc.queryForObject("SELECT stage FROM opportunity",String.class)).isEqualTo("DISCOVERED");
        jdbc.update("INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,payload) VALUES(1,1,'message2','HR_INBOUND_OBSERVED','HR_OBSERVATION','{\"conversationId\":7}')");
        assertThat(workbench.list("HR_REVIEW",null,false,1,20)).containsEntry("total",1L);
        assertThatThrownBy(()->opportunities.reviewObservations(1,new OpportunityService.ObservationReview(1,999))).hasMessageContaining("不属于");
    }
}
