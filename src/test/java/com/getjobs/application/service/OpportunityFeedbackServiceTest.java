package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class OpportunityFeedbackServiceTest {
    @TempDir Path directory;
    JdbcTemplate jdbc;
    OpportunityFeedbackService feedback;
    HrAssistantStore hr;
    ProfileService profiles;
    long first,second,conversation;
    @BeforeEach void setup() {
        var source=new DriverManagerDataSource("jdbc:sqlite:"+directory.resolve("feedback.db"));
        Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
        jdbc=new JdbcTemplate(source);
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'fixture',1),(2,'other',0)");
        jdbc.update("INSERT INTO boss_data(profile_id,encrypt_id,job_name,company_name) VALUES(1,'a','岗位A','同名公司'),(1,'b','岗位B','同名公司')");
        first=jdbc.queryForObject("SELECT id FROM opportunity WHERE job_key='a'",Long.class);
        second=jdbc.queryForObject("SELECT id FROM opportunity WHERE job_key='b'",Long.class);
        profiles=mock(ProfileService.class);when(profiles.getCurrentProfileId()).thenReturn(1L);
        var crypto=new HrAssistantCryptoService(directory.resolve("fixture.key"));
        hr=new HrAssistantStore(jdbc,crypto,new ObjectMapper());
        feedback=new OpportunityFeedbackService(jdbc,new DataSourceTransactionManager(source),profiles,hr,crypto,new ObjectMapper());
        conversation=hr.upsertConversation(1L,new ChatSession("fixture-hr","","虚构HR","同名公司","岗位A","","",""));
    }
    long version(long id) { return jdbc.queryForObject("SELECT version FROM opportunity WHERE id=?",Long.class,id); }
    void link(long id,String key,boolean active) { feedback.link(id,new OpportunityFeedbackService.Link(version(id),key,conversation,active)); }
    OpportunityFeedbackService.Feedback event(String key,String type,Long conversationId) {
        return new OpportunityFeedbackService.Feedback(version(first),key,type,null,null,null,conversationId,null,"PRIVATE-FEEDBACK");
    }
    @Test void legacyNameMatchIsOnlyACandidateAndMessagesNeverConfirmAnOffer() {
        assertThat(feedback.conversations(first).getFirst()).containsEntry("candidate",true).containsEntry("linked",0);
        assertThatThrownBy(()->feedback.messages(first,conversation)).hasMessageContaining("先确认");
        hr.saveMessage(conversation,new ChatMessage("对方","text","这是一条虚构 Offer 邀请","昨天"),30);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE source='HR_OBSERVATION'",Integer.class)).isZero();
        link(first,"link-a",true);
        hr.saveMessage(conversation,new ChatMessage("对方","text","合成面试邀请","今天"),30);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE type='HR_INBOUND_OBSERVED'",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT stage FROM opportunity WHERE id=?",String.class,first)).isEqualTo("DISCOVERED");
        feedback.feedback(first,event("offer","OFFER",conversation));
        assertThat(jdbc.queryForObject("SELECT stage FROM opportunity WHERE id=?",String.class,first)).isEqualTo("OFFER");
        assertThat(jdbc.queryForObject("SELECT reason_cipher FROM opportunity_event WHERE type='OUTCOME_OFFER'",String.class)).doesNotContain("PRIVATE-FEEDBACK");
    }
    @Test void oneHrMultipleJobsRequiresExplicitPerOutcomeAttribution() {
        link(first,"a",true);link(second,"b",true);
        hr.saveMessage(conversation,new ChatMessage("对方","text","另一条虚构信息","今天"),30);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE source='HR_OBSERVATION'",Integer.class)).isZero();
        feedback.feedback(first,event("reply","RECRUITER_REPLIED",conversation));
        assertThat(jdbc.queryForObject("SELECT stage FROM opportunity WHERE id=?",String.class,first)).isEqualTo("RECRUITER_REPLIED");
        assertThat(jdbc.queryForObject("SELECT stage FROM opportunity WHERE id=?",String.class,second)).isEqualTo("DISCOVERED");
        when(profiles.getCurrentProfileId()).thenReturn(2L);
        assertThatThrownBy(()->feedback.messages(first,conversation)).hasMessageContaining("不属于");
        assertThatThrownBy(()->feedback.link(first,new OpportunityFeedbackService.Link(0,"foreign",conversation,true))).hasMessageContaining("不属于");
    }
    @Test void purgePreservesConfirmedFeedbackLinksAndDeduplicationWithoutMessageBodies() {
        link(first,"link",true);
        var message=new ChatMessage("对方","text","PRIVATE-CHAT-BODY","昨天");
        hr.saveMessage(conversation,message,30);
        var event=event("reply","RECRUITER_REPLIED",conversation);
        feedback.feedback(first,event);feedback.feedback(first,event);
        jdbc.update("UPDATE hr_message SET expires_at='2000-01-01'");
        jdbc.update("UPDATE hr_conversation SET last_observed_at='2000-01-01'");
        hr.purgeExpired();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM hr_message",Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_conversation WHERE active=1",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE type='OUTCOME_RECRUITER_REPLIED'",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT payload FROM opportunity_event").toString()).doesNotContain("PRIVATE-CHAT-BODY");
        hr.saveMessage(conversation,message,30);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE type='HR_INBOUND_OBSERVED'",Integer.class)).isEqualTo(1);
    }
    @Test void absenceRequiresAConfirmedAttemptAndAnExplicitObservationCutoff() {
        assertThatThrownBy(()->feedback.feedback(first,event("missing","NO_REPLY_OBSERVED",null))).hasMessageContaining("截止时间");
        var request=new OpportunityFeedbackService.Feedback(version(first),"unknown","NO_REPLY_OBSERVED",null,"2026-01-01T00:00:00Z",999L,null,null,null);
        assertThatThrownBy(()->feedback.feedback(first,request)).hasMessageContaining("未确认");
        assertThatThrownBy(()->feedback.feedback(first,new OpportunityFeedbackService.Feedback(version(first),"future","OFFER","2099-01-01T00:00:00Z",null,null,null,null,null))).hasMessageContaining("未来");
        assertThatThrownBy(()->feedback.feedback(first,event("","OFFER",null))).hasMessageContaining("操作标识");
    }
    @Test void acceptedSearchAndTaskShareOneDiscoveryAttributionAndKeepTheFirstKeyword() {
        jdbc.update("INSERT INTO job_analysis_task(profile_id,platform,status,task_key,job_key,job_row_id,scan_run_id,request_json) VALUES(1,'boss','PENDING','fixture-search','a',1,'run-a','{\"keyword\":\"AI应用\"}')");
        jdbc.update("INSERT INTO fresh_scan_receipt(profile_id,platform,scan_run_id,job_key,keyword,eligible) VALUES(1,'boss','run-a','a','AI应用',1)");
        jdbc.update("UPDATE fresh_scan_receipt SET accepted=1");
        jdbc.update("UPDATE fresh_scan_receipt SET accepted=1,keyword='后来的关键词'");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE type='SEARCH_DISCOVERY'",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT json_extract(payload,'$.keyword') FROM opportunity_event WHERE type='SEARCH_DISCOVERY'",String.class)).isEqualTo("AI应用");
    }
    @Test void lateDeliveryCallbackDoesNotInvalidateAnEarlierRealReplyAfterTheRequest() {
        jdbc.update("INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,occurred_at,payload) VALUES(?,1,'attempt:90:REQUESTED','APPLICATION_REQUESTED','APPLICATION_SERVICE','2020-01-01 01:00:00','{\"attemptId\":90}')",first);
        jdbc.update("INSERT INTO delivery_attempt(id,request_key,platform,profile_id,job_key,job_row_id,state,requested_at,updated_at) VALUES(90,'late','boss',1,'a',1,'CONFIRMED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        feedback.feedback(first,new OpportunityFeedbackService.Feedback(version(first),"reply-before-callback","RECRUITER_REPLIED","2020-01-01T02:00:00Z",null,90L,null,null,null));
        assertThat(jdbc.queryForObject("SELECT stage FROM opportunity WHERE id=?",String.class,first)).isEqualTo("RECRUITER_REPLIED");
        assertThatThrownBy(()->feedback.feedback(first,new OpportunityFeedbackService.Feedback(version(first),"reply-before-request","RECRUITER_REPLIED","2020-01-01T00:00:00Z",null,90L,null,null,null))).hasMessageContaining("早于");
    }
}
