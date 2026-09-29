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

class HrVisualStoreTest {
    @TempDir Path temp;
    JdbcTemplate db;
    HrAssistantStore hr;
    HrVisualStore visual;
    ChatCapture capture;
    long conversation,proposal;
    String run,command;
    @BeforeEach void setup() {
        var ds=new DriverManagerDataSource("jdbc:sqlite:"+temp.resolve("visual.db"));
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        db=new JdbcTemplate(ds);db.update("INSERT INTO profile(id,name,is_active) VALUES (1,'测试账号',1)");
        var crypto=new HrAssistantCryptoService(temp.resolve("key"));var json=new ObjectMapper();
        hr=new HrAssistantStore(db,crypto,json);visual=new HrVisualStore(db,crypto,json);
        var session=new ChatSession("opaque-platform-id","","测试HR","测试公司","岗位","","你好","09-23 14:00");
        var inbound=new ChatMessage("对方","文本","你好","09-23 14:00");
        capture=new ChatCapture("capture",0,session,List.of(inbound),false,true);
        conversation=hr.upsertConversation(1L,session);hr.saveMessage(conversation,inbound,30);
        var fingerprint=hr.sourceFingerprint(conversation,inbound);hr.updateLastInbound(conversation,fingerprint);
        proposal=hr.createProposal(1L,conversation,fingerprint,new AiDraft(Classification.REPLY,"您好","说明",List.of(),List.of(),1));
        var seed=new Seed(session.uid(),session.hrName(),session.companyName(),session.jobName(),"您好",true,true,capture);
        run=visual.create(1L,"测试账号",List.of(proposal),List.of(conversation),List.of(seed));
        visual.target(visual.targets(run).getFirst().id(),proposal,"QUEUED","");
        command=hr.queueSendCommand(1L,proposal,1,"visual:"+run);visual.attach(command,true);
    }
    @Test void chromeCannotClaimVisualCommandsAndWhitelistSurvivesRestart() {
        assertThat(hr.claimSendCommand(1L,"chrome",Set.of(proposal))).isNull();
        assertThat(visual.owner(2L,proposal)).isNull();
        assertThat(visual.claim(1L,proposal+1)).isNull();
        assertThat(visual.claim(2L,proposal)).isNull();
        assertThat(visual.owner(1L,proposal).seed().companyName()).isEqualTo("测试公司");
        assertThat(db.queryForObject("SELECT seed_cipher FROM hr_visual_target",String.class)).doesNotContain("测试HR","您好");
    }
    @Test void stepsAreOrderedPacedAndUnknownResumeNeverResendsText() {
        var text=visual.claim(1L,proposal);assertThat(text.actionType()).isEqualTo("TEXT");
        assertThat(visual.claim(1L,proposal)).isNull();
        visual.submitting(text);visual.finish(text,"SENT_CONFIRMED",Map.of("receipt","first"));
        assertThat(visual.claim(1L,proposal)).isNull();
        db.update("UPDATE hr_send_step SET finished_at=? WHERE id=?",System.currentTimeMillis()-6000,text.id());
        var resume=visual.claim(1L,proposal);assertThat(resume.actionType()).isEqualTo("RESUME_NATIVE");
        visual.submitting(resume);visual.finish(resume,"SEND_UNKNOWN",Map.of("receipt","unknown"));
        assertThat(visual.claim(1L,proposal)).isNull();
        assertThat(visual.steps(proposal)).extracting(m->m.get("status")).containsExactly("SENT_CONFIRMED","SEND_UNKNOWN");
        assertThatThrownBy(()->visual.finish(text,"SENT_CONFIRMED",Map.of())).isInstanceOf(IllegalStateException.class);
    }
    @Test void restartAndWrongLeaseCannotTriggerSecondSubmission() {
        var step=visual.claim(1L,proposal);visual.submitting(step);
        assertThatThrownBy(()->visual.submitting(new Step(step.id(),step.commandId(),0,"TEXT","wrong"))).isInstanceOf(IllegalStateException.class);
        assertThat(visual.recover()).containsExactly(proposal);
        assertThat(visual.claim(1L,proposal)).isNull();
        assertThat(visual.run(1L,run).status()).isEqualTo("PAUSED");
        assertThat(visual.steps(proposal).getFirst().get("status")).isEqualTo("SEND_UNKNOWN");
    }
    @Test void expiredAndPausedCommandsCannotBeClaimed() {
        visual.state(run,"PAUSED","");assertThat(visual.claim(1L,proposal)).isNull();
        visual.state(run,"RUNNING","");db.update("UPDATE hr_send_command SET expires_at='2000-01-01 00:00:00'");
        assertThat(visual.claim(1L,proposal)).isNull();
    }
    @Test void receiptsRequireWholeRoundAndExactNewOwnTail() {
        var expected=List.of(new ChatMessage("对方","文本","你好",""),new ChatMessage("对方","文本","工作地点？",""));
        var after=new ArrayList<>(expected);after.add(new ChatMessage("本人","文本","深圳",""));
        assertThat(HrVisualService.receipt(after,expected,List.of("深圳"),"TEXT")).isTrue();
        assertThat(HrVisualService.receipt(expected,expected,List.of("深圳"),"TEXT")).isFalse();
        assertThat(HrVisualService.receipt(after,expected,List.of("深圳南山"),"TEXT")).isFalse();
        after.add(new ChatMessage("对方","文本","新问题",""));
        assertThat(HrVisualService.receipt(after,expected,List.of("深圳"),"TEXT")).isFalse();
    }
    @Test void restartBetweenStepsKeepsConfirmedTextAndResumesOnlyPendingResume() {
        var text=visual.claim(1L,proposal);visual.submitting(text);visual.finish(text,"SENT_CONFIRMED",Map.of());
        visual.target(visual.targets(run).getFirst().id(),proposal,"PARTIAL","");
        assertThat(visual.recover()).isEmpty();
        assertThat(visual.targets(run).getFirst().status()).isEqualTo("PARTIAL");
        assertThat(visual.claim(1L,proposal)).isNull();
        visual.state(run,"RUNNING","");db.update("UPDATE hr_send_step SET finished_at=? WHERE id=?",System.currentTimeMillis()-6000,text.id());
        assertThat(visual.claim(1L,proposal).actionType()).isEqualTo("RESUME_NATIVE");
    }
    @Test void expiredQueueBecomesVisibleStaleAndRetentionPreservesStepReceipts() {
        db.update("UPDATE hr_reply_proposal SET expires_at='2000-01-01 00:00:00'");visual.expire(run);
        assertThat(visual.targets(run).getFirst().status()).isEqualTo("STALE");
        assertThat(visual.steps(proposal)).extracting(m->m.get("status")).containsOnly("STALE");
        db.update("UPDATE hr_send_command SET updated_at='2000-01-01 00:00:00'");hr.purgeExpired();
        assertThat(visual.steps(proposal)).hasSize(2);
    }
    @Test void sensitiveCopiesExpireButUnknownAndConfirmedResultsRemain() {
        var step=visual.claim(1L,proposal);visual.submitting(step);visual.finish(step,"SEND_UNKNOWN",Map.of("detail","正文"));
        visual.state(run,"COMPLETED","");db.update("UPDATE hr_visual_run SET created_at='2000-01-01 00:00:00'");
        assertThat(visual.purgeSensitiveCopies()).hasSize(2);
        assertThat(visual.targets(run).getFirst().seed().expected().messages()).isEmpty();
        assertThat(visual.steps(proposal).getFirst().get("status")).isEqualTo("SEND_UNKNOWN");
        assertThat(visual.run(1L,run).status()).isEqualTo("ARCHIVED");
        assertThat(visual.purgeSensitiveCopies()).hasSize(2); // A failed file cleanup can retry without reviving delivery.
    }
}
