package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.*;
import com.getjobs.application.hr.HrVisualTypes.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class HrVisualBatchStoreTest {
    @TempDir Path temp;
    JdbcTemplate db;
    ObjectMapper json=new ObjectMapper();
    HrAssistantStore hr;
    HrVisualStore visual;
    HrVisualBatchStore batches;
    String batch;
    record Fixture(String run,String target,long conversation,long proposal,String command) { }

    @BeforeEach void setup() {
        var ds=new DriverManagerDataSource("jdbc:sqlite:"+temp.resolve("batch.db"));
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        db=new JdbcTemplate(ds);db.update("INSERT INTO profile(id,name,is_active) VALUES (1,'测试账号',1)");
        var crypto=new HrAssistantCryptoService(temp.resolve("key"));
        hr=new HrAssistantStore(db,crypto,json);visual=new HrVisualStore(db,crypto,json);batches=new HrVisualBatchStore(db,crypto,json);
        batch=batches.create(1L,"测试账号","batch-fixture","fixture-hash");
    }
    private String contact(String batchId,String name,String status) {
        batches.add(batchId,"CONTACT",json.valueToTree(Map.of("hrName",name,"companyName","公司"+name,"identityComplete",true)),null);
        var item=batches.items(batchId).stream().filter(i->i.kind().equals("CONTACT") && i.contact().path("hrName").asText().equals(name)).findFirst().orElseThrow();
        batches.outcome(item.id(),status,"合成状态原因："+status);return item.id();
    }
    private Fixture linked(String batchId,String name,boolean resumeOnly,boolean withResume) {
        String item=contact(batchId,name,"PENDING");
        var session=new ChatSession("uid:"+name,"",name,"公司"+name,"岗位","","你好","09-23 14:00");
        var inbound=new ChatMessage("对方","文本","你好","09-23 14:00");
        var capture=new ChatCapture("capture:"+name,0,session,List.of(inbound),false,true);
        long conversation=hr.upsertConversation(1L,session);String fingerprint=hr.sourceFingerprint(conversation,inbound);
        hr.updateLastInbound(conversation,fingerprint);
        long proposal=hr.createProposal(1L,conversation,fingerprint,new AiDraft(Classification.REPLY,"您好","",List.of(),List.of(),1));
        String run=visual.create(1L,"测试账号",List.of(proposal),List.of(conversation),List.of(new Seed(session.uid(),name,session.companyName(),"岗位","您好",withResume,true,capture)));
        var target=visual.targets(run).getFirst();visual.target(target.id(),proposal,"QUEUED","");
        String command=hr.queueSendCommand(1L,proposal,1,"visual:"+run);
        if(resumeOnly)visual.attachResumeOnly(command);else visual.attach(command,withResume);
        batches.link(item,conversation,run,null);batches.observed(item);visual.state(run,"COMPLETED","合成夹具已就绪");
        return new Fixture(run,target.id(),conversation,proposal,command);
    }
    private Step claim(Fixture fixture) {
        // Move the persisted clock in the fixture; acceptance tests do not need a real five-second sleep.
        db.update("UPDATE hr_send_step SET finished_at=? WHERE finished_at IS NOT NULL",System.currentTimeMillis()-6000);
        visual.state(fixture.run(),"RUNNING","");var step=visual.claim(1L,fixture.proposal());assertThat(step).isNotNull();
        visual.submitting(step);return step;
    }
    private void finish(Fixture fixture,String outcome,String targetStatus) {
        visual.finish(claim(fixture),outcome,Map.of("detail","合成回执"));
        visual.target(fixture.target(),fixture.proposal(),targetStatus,"合成最终状态");visual.state(fixture.run(),"COMPLETED","");
    }

    @Test void confirmedStepsStaySeparateFromUnknownResumeAndFromOtherBatchesOrOldAnchors() {
        var partial=linked(batch,"部分成功",false,true);
        finish(partial,"SENT_CONFIRMED","PARTIAL");finish(partial,"SEND_UNKNOWN","SEND_UNKNOWN");
        var resume=linked(batch,"简历成功",true,false);finish(resume,"SENT_CONFIRMED","SENT_CONFIRMED");
        String other=batches.create(1L,"测试账号","other-batch","other-hash");
        var old=linked(other,"旧批成功",false,true);finish(old,"SENT_CONFIRMED","PARTIAL");finish(old,"SEND_UNKNOWN","SEND_UNKNOWN");
        batches.add(batch,"ANCHOR",json.valueToTree(Map.of("hrName","旧批成功","companyName","公司旧批成功")),old.conversation());
        contact(batch,"无需处理","SKIPPED");contact(batch,"排除测试","EXCLUDED");contact(batch,"未读取","PENDING");
        var status=batches.status(1L,batch);
        assertThat(status).containsEntry("textSentConfirmed",1L).containsEntry("resumeSentConfirmed",1L).containsEntry("sent",1L)
                .containsEntry("discovered",5L).containsEntry("checked",2L).containsEntry("unknown",1L).containsEntry("unknownSteps",1L).containsEntry("pending",1L)
                .containsEntry("noReply",1L).containsEntry("excluded",1L).containsEntry("coverageComplete",false);
        assertThat(json.valueToTree(status).path("statusCounts").path("SEND_UNKNOWN").asLong()).isEqualTo(1);
        assertThat(batches.status(1L,other)).containsEntry("textSentConfirmed",1L).containsEntry("resumeSentConfirmed",0L).containsEntry("unknownSteps",1L);
    }

    @Test void persistedTextReceiptSurvivesRestartWhileSubmittingResumeBecomesUnknownWithoutRetry() {
        var partial=linked(batch,"重启续跑",false,true);finish(partial,"SENT_CONFIRMED","PARTIAL");
        var resume=claim(partial);assertThat(resume.actionType()).isEqualTo("RESUME_NATIVE");
        assertThat(batches.status(1L,batch)).containsEntry("textSentConfirmed",1L).containsEntry("resumeSentConfirmed",0L).containsEntry("pending",1L);
        var reopenedDb=new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:"+temp.resolve("batch.db")));
        var reopenedCrypto=new HrAssistantCryptoService(temp.resolve("key"));
        var recoveredVisual=new HrVisualStore(reopenedDb,reopenedCrypto,json);
        var recoveredBatches=new HrVisualBatchStore(reopenedDb,reopenedCrypto,json);
        for(long proposal:recoveredVisual.recover())hr.markFinal(proposal,ProposalStatus.SEND_UNKNOWN,"重启未知");
        recoveredBatches.recover();
        assertThat(recoveredBatches.status(1L,batch)).containsEntry("textSentConfirmed",1L).containsEntry("resumeSentConfirmed",0L)
                .containsEntry("unknown",1L).containsEntry("unknownSteps",1L).containsEntry("sent",0L).containsEntry("pending",0L).containsEntry("status","PAUSED").containsEntry("coverageComplete",false);
        assertThat(recoveredVisual.claim(1L,partial.proposal())).isNull();
        assertThat(recoveredVisual.steps(partial.proposal())).extracting(s->s.get("status")).containsExactly("SENT_CONFIRMED","SEND_UNKNOWN");
    }

    @Test void reconfirmedTargetKeepsItsEarlierConfirmedStepButChromeTransportIsExcluded() {
        var first=linked(batch,"重新确认",false,true);finish(first,"SENT_CONFIRMED","PARTIAL");finish(first,"SEND_UNKNOWN","SEND_UNKNOWN");
        hr.markFinal(first.proposal(),ProposalStatus.SEND_UNKNOWN,"前次简历未知，保留原始回执");
        var inbound=new ChatMessage("对方","文本","请发简历","09-24 14:00");String fingerprint=hr.sourceFingerprint(first.conversation(),inbound);
        hr.updateLastInbound(first.conversation(),fingerprint);
        long next=hr.createProposal(1L,first.conversation(),fingerprint,new AiDraft(Classification.DOCUMENT_REQUEST,"原生简历","",List.of(),List.of(),1));
        visual.target(first.target(),next,"QUEUED","");String command=hr.queueSendCommand(1L,next,1,"visual:"+first.run());visual.attachResumeOnly(command);
        finish(new Fixture(first.run(),first.target(),first.conversation(),next,command),"SENT_CONFIRMED","SENT_CONFIRMED");
        // A differently transported command must not enter this visual batch's delivery totals.
        String bridgeFingerprint=hr.sourceFingerprint(first.conversation(),new ChatMessage("对方","文本","其他通道消息","09-25 14:00"));
        hr.updateLastInbound(first.conversation(),bridgeFingerprint);
        long bridgeProposal=hr.createProposal(1L,first.conversation(),bridgeFingerprint,new AiDraft(Classification.REPLY,"您好","",List.of(),List.of(),1));
        String bridgeCommand=hr.queueSendCommand(1L,bridgeProposal,1,"visual:"+first.run());
        db.update("INSERT INTO hr_send_step(id,command_id,ordinal,action_type,status) VALUES (?,?,?,?,?)","chrome-step",bridgeCommand,1,"TEXT","SENT_CONFIRMED");
        assertThat(batches.status(1L,batch)).containsEntry("textSentConfirmed",1L).containsEntry("resumeSentConfirmed",1L).containsEntry("sent",1L)
                .containsEntry("unknown",0L).containsEntry("unknownSteps",1L);
        assertThat(visual.steps(first.proposal())).extracting(s->s.get("status")).containsExactly("SENT_CONFIRMED","SEND_UNKNOWN");
        assertThat(visual.steps(next)).extracting(s->s.get("status")).containsExactly("SENT_CONFIRMED");
    }

    @Test void contactClassificationsUseCurrentTargetStateAndKeepUnreadFailuresDistinct() {
        for(String status:List.of("BLOCKED","READ_FAILED","DATE_UNKNOWN","STALE","PENDING","PRIORITY_PENDING","PENDING_CAPTURE","QUEUED","PARTIAL","REVIEW_REQUIRED","SKIPPED","EXCLUDED"))contact(batch,status,status);
        for(String status:List.of("REVIEW_REQUIRED","SENT_CONFIRMED")){
            batches.add(batch,"ANCHOR",json.valueToTree(Map.of("hrName","旧锚点"+status,"companyName","旧公司")),null);
            var anchor=batches.items(batch).stream().filter(i->i.kind().equals("ANCHOR") && i.contact().path("hrName").asText().equals("旧锚点"+status)).findFirst().orElseThrow();
            batches.outcome(anchor.id(),status,"合成旧锚点状态，不能混入本轮联系人统计");
        }
        var status=batches.status(1L,batch);
        assertThat(status).containsEntry("discovered",12L).containsEntry("pending",5L).containsEntry("pendingReview",1L)
                .containsEntry("blocked",1L).containsEntry("readFailed",1L).containsEntry("dateUnknown",1L).containsEntry("stale",1L)
                .containsEntry("noReply",1L).containsEntry("excluded",1L).containsEntry("unknown",0L).containsEntry("sent",0L).containsEntry("textSentConfirmed",0L).containsEntry("resumeSentConfirmed",0L);
        assertThat(json.valueToTree(status).path("statusCounts").size()).isEqualTo(12);
    }
}
