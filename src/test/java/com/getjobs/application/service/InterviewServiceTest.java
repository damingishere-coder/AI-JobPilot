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
import java.util.List;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class InterviewServiceTest {
    @TempDir Path directory;
    JdbcTemplate jdbc;InterviewService interviews;ProfileService profiles;
    @BeforeEach void setup() {
        var source=new DriverManagerDataSource("jdbc:sqlite:"+directory.resolve("interview.db"));
        Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
        jdbc=new JdbcTemplate(source);
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'fixture',1),(2,'other',0)");
        jdbc.update("INSERT INTO opportunity(id,profile_id,platform,job_key) VALUES(1,1,'boss','fixture'),(2,2,'boss','foreign')");
        profiles=mock(ProfileService.class);when(profiles.getCurrentProfileId()).thenReturn(1L);
        interviews=new InterviewService(jdbc,profiles,new DataSourceTransactionManager(source),new HrAssistantCryptoService(directory.resolve("fixture.key")),new ObjectMapper());
    }
    long version() { return jdbc.queryForObject("SELECT version FROM opportunity WHERE id=1",Long.class); }
    InterviewService.Save save(Long id,long version,String key,int round,String when,String status) {
        return new InterviewService.Save(id,version,version(),key,round,when,"Asia/Shanghai","ONLINE",status,List.of("JOB_RESUME"),"PRIVATE-INTERVIEW-NOTE");
    }
    @Test void invitationDoesNotScheduleAndTwoRoundsCanBeRescheduledIndependently() {
        var pending=save(null,0,"pending",1,null,"PENDING");
        long first=((Number)interviews.save(1,pending).get("id")).longValue();
        assertThat(interviews.save(1,pending)).containsEntry("duplicate",true);
        assertThat(jdbc.queryForObject("SELECT stage FROM opportunity WHERE id=1",String.class)).isEqualTo("DISCOVERED");
        assertThatThrownBy(()->interviews.save(1,save(first,0,"missing-time",1,null,"SCHEDULED"))).hasMessageContaining("确认时间");
        interviews.save(1,save(first,0,"schedule",1,"2030-01-01T10:00:00+08:00","SCHEDULED"));
        long second=((Number)interviews.save(1,save(null,0,"round-two",2,"2030-01-02T10:00:00+08:00","SCHEDULED")).get("id")).longValue();
        interviews.save(1,save(first,1,"reschedule",1,"2030-01-03T10:00:00+08:00","SCHEDULED"));
        assertThat(jdbc.queryForObject("SELECT scheduled_at FROM interview WHERE id=?",String.class,first)).isEqualTo("2030-01-03T02:00:00Z");
        assertThat(jdbc.queryForObject("SELECT scheduled_at FROM interview WHERE id=?",String.class,second)).isEqualTo("2030-01-02T02:00:00Z");
        assertThat(jdbc.queryForObject("SELECT stage FROM opportunity WHERE id=1",String.class)).isEqualTo("INTERVIEW");
        assertThat(jdbc.queryForObject("SELECT note_cipher FROM interview WHERE id=?",String.class,first)).doesNotContain("PRIVATE-INTERVIEW-NOTE");
        assertThatThrownBy(()->jdbc.update("UPDATE opportunity SET archived=1 WHERE id=1")).hasMessageContaining("已安排面试");
        interviews.save(1,save(first,2,"cancel",1,"2030-01-03T02:00:00Z","CANCELLED"));
        assertThat(jdbc.queryForObject("SELECT status FROM interview WHERE id=?",String.class,second)).isEqualTo("SCHEDULED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE type='INTERVIEW_UPDATED' AND json_extract(payload,'$.previousScheduledAt')<>json_extract(payload,'$.scheduledAt')",Integer.class)).isEqualTo(1);
    }
    @Test void staleForeignAndDuplicateRoundWritesAreRejected() {
        long id=((Number)interviews.save(1,save(null,0,"first",1,null,"PENDING")).get("id")).longValue();
        assertThatThrownBy(()->interviews.save(1,save(null,0,"same-round",1,null,"PENDING"))).hasMessageContaining("该轮");
        assertThatThrownBy(()->interviews.save(1,save(id,88,"stale",1,null,"PENDING"))).hasMessageContaining("面试已更新");
        assertThatThrownBy(()->interviews.save(2,save(null,0,"foreign",2,null,"PENDING"))).hasMessageContaining("不属于");
        when(profiles.getCurrentProfileId()).thenReturn(2L);
        assertThat(interviews.list(null,1,20)).containsEntry("total",0L);
        assertThatThrownBy(()->interviews.list(1L,1,20)).hasMessageContaining("不属于");
    }
    @Test void preparationAndMatureTimeBoundariesDriveWorkbenchWithoutInventingCompletion() {
        long id=((Number)interviews.save(1,save(null,0,"scheduled",1,"2030-01-02T02:00:00Z","SCHEDULED")).get("id")).longValue();
        var workbench=new OpportunityWorkbenchService(jdbc,profiles,java.time.Clock.fixed(java.time.Instant.parse("2030-01-01T02:00:00Z"),java.time.ZoneOffset.UTC));
        assertThat(workbench.list("INTERVIEW_PREPARE",null,false,1,20)).containsEntry("total",1L);
        assertThat(workbench.list("INTERVIEW_SCHEDULED",null,false,1,20)).containsEntry("total",1L);
        interviews.save(1,new InterviewService.Save(id,0,version(),"prepared",1,"2030-01-02T02:00:00Z","Asia/Shanghai","ONLINE","SCHEDULED",List.copyOf(InterviewService.PREPARATION),"note"));
        assertThat(workbench.list("INTERVIEW_PREPARE",null,false,1,20)).containsEntry("total",0L);
        var later=new OpportunityWorkbenchService(jdbc,profiles,java.time.Clock.fixed(java.time.Instant.parse("2030-01-03T02:00:00Z"),java.time.ZoneOffset.UTC));
        assertThat(later.list("INTERVIEW_CHECK",null,false,1,20)).containsEntry("total",1L);
        assertThat(jdbc.queryForObject("SELECT status FROM interview WHERE id=?",String.class,id)).isEqualTo("SCHEDULED");
        assertThatThrownBy(()->interviews.save(1,save(id,1,"future-complete",1,"2999-01-01T00:00:00Z","COMPLETED"))).hasMessageContaining("未来");
        interviews.save(1,save(id,1,"cancel",1,"2030-01-02T02:00:00Z","CANCELLED"));
        assertThat(workbench.list("INTERVIEW_SCHEDULED",null,false,1,20)).containsEntry("total",0L);
        assertThatCode(()->jdbc.update("UPDATE opportunity SET archived=1 WHERE id=1")).doesNotThrowAnyException();
    }
}
