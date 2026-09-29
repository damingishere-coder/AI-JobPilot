package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.entity.ProfileEntity;
import com.getjobs.application.hr.HrAssistantTypes.*;
import com.getjobs.application.hr.HrVisualTypes.*;
import com.getjobs.application.hr.HrVisualTypes;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.file.Path;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class HrVisualServiceTest {
    @TempDir Path temp;
    JdbcTemplate db;
    HrAssistantStore store;
    HrVisualStore visual;
    HrAutopilotStore policies;
    HrVisualService service;
    HrVisualWorker worker=mock(HrVisualWorker.class);
    HrAutopilotService ai=mock(HrAutopilotService.class);
    NapCatGateway qq=mock(NapCatGateway.class);
    ProfileService profiles=mock(ProfileService.class);
    ObjectMapper json=new ObjectMapper();
    List<TargetRequest> targets=new ArrayList<>();
    List<ChatCapture> captures=new ArrayList<>();

    @BeforeEach void setup() {
        var ds=new DriverManagerDataSource("jdbc:sqlite:"+temp.resolve("test.db"));
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        db=new JdbcTemplate(ds);db.update("INSERT INTO profile(id,name,is_active) VALUES (1,'档案姓名',1)");
        var crypto=new HrAssistantCryptoService(temp.resolve("key"));
        store=new HrAssistantStore(db,crypto,json);visual=new HrVisualStore(db,crypto,json);
        policies=new HrAutopilotStore(db,json,crypto,store);
        store.saveSettings(1L,CommunicationProfile.empty(),true,"ws://127.0.0.1:3001","test-only-token",QqTargetType.PRIVATE,"123456","",30);
        when(profiles.getCurrentProfileId()).thenReturn(1L);when(profiles.getCurrentProfileIdOrNull()).thenReturn(1L);
        var profile=new ProfileEntity();profile.setName("档案姓名");when(profiles.getCurrentProfile()).thenReturn(profile);
        when(worker.availability()).thenReturn(Map.of("installed",true));when(qq.isConnected()).thenReturn(true);
        service=new HrVisualService(visual,store,policies,ai,worker,new HrProfileGuard(),profiles,qq,json,new TransactionTemplate(new DataSourceTransactionManager(ds)));
        service.initialize();
        for(int i=0;i<3;i++) {
            var session=new ChatSession("uid"+i,"","HR"+i,"公司"+i,"岗位"+i,"","你好","09-23 14:00");
            var capture=new ChatCapture("c"+i,0,session,List.of(new ChatMessage("本人","文本","上轮","09-22 11:00"),new ChatMessage("对方","文本","你好","09-23 14:00")),false,true);
            captures.add(capture);long conversation=store.upsertConversation(1L,session);
            policies.context(conversation,capture);
            var fingerprint=store.sourceFingerprint(conversation,capture.messages().getLast());store.updateLastInbound(conversation,fingerprint);
            long p=store.createProposal(1L,conversation,fingerprint,new AiDraft(Classification.REPLY,"旧草稿","",List.of(),List.of(),1));
            targets.add(new TargetRequest(p,1,"您好",i==0,true,"USER_CONFIRMED_TEST",i==0,session.jobName()));
        }
    }
    @AfterEach void close(){service.shutdown();}
    StartRequest startRequest(List<TargetRequest> selected,boolean confirmed){return new StartRequest(1L,HrVisualTypes.PROTOCOL,selected,"登录姓名",confirmed);}
    void advance(){ReflectionTestUtils.invokeMethod(service,"advance");}
    void nextCapture(ChatCapture capture){
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(Map.of("ok",true,"capture",Map.of(
                "hrName",capture.session().hrName(),"companyName",capture.session().companyName(),"jobName",capture.session().jobName(),
                "messages",capture.messages(),"contextComplete",true))));
    }
    @Test void requiresExplicitAccountBindingAndSingleUseResumePermission() {
        assertThatThrownBy(()->service.start(startRequest(targets,false))).hasMessageContaining("账号绑定");
        var invalid=new ArrayList<>(targets);var t=targets.getFirst();
        invalid.set(0,new TargetRequest(t.proposalId(),1,"您好",true,true,"USER_CONFIRMED_TEST",false,"岗位0"));
        assertThatThrownBy(()->service.start(startRequest(invalid,true))).hasMessageContaining("独立分享确认");
        assertThat(visual.runs(1L)).isEmpty();
        service.start(startRequest(targets,true));assertThat(visual.runs(1L).getFirst().account()).isEqualTo("登录姓名");
    }
    @Test void manualReplyInvalidatesOriginalConfirmationCode() {
        service.start(startRequest(targets,true));var old=captures.getFirst();var messages=new ArrayList<>(old.messages());messages.add(new ChatMessage("本人","文本","本人已处理","今天"));
        nextCapture(new ChatCapture("new",0,old.session(),messages,false,true));advance();
        assertThat(store.requireProposal(1L,targets.getFirst().proposalId()).status()).isEqualTo(ProposalStatus.EXPIRED);
        assertThat(visual.targets(visual.runs(1L).getFirst().id()).getFirst().status()).isEqualTo("SKIPPED");
        verify(qq,never()).notifyProposal(any());
    }
    @Test void allThreeAreReadBeforeAnyApprovedSendAndQueueIsIdempotent() {
        service.start(startRequest(targets,true));
        for(var c:captures){nextCapture(c);advance();}
        var result=visual.targets(visual.runs(1L).getFirst().id());
        assertThat(result).extracting(Target::status).containsOnly("QUEUED");
        verify(worker,times(3)).exchange(argThat(m->"inspect".equals(m.get("operation"))),isNull());
        assertThatThrownBy(()->service.queue(1L,result.getFirst().proposalId(),1)).hasMessageContaining("未重复发送");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isEqualTo(3);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_step",Integer.class)).isEqualTo(4);
    }
    @Test void changedHrRoundRevokesOldTextAndResumeApprovalAndNotifiesQq() {
        service.start(startRequest(targets,true));var old=captures.getFirst();
        nextCapture(new ChatCapture("new",0,old.session(),List.of(old.messages().getFirst(),new ChatMessage("对方","文本","新问题","今天")),false,true));
        when(ai.generate(any(),anyLong(),any(),any())).thenThrow(new IllegalStateException("AI offline"));advance();
        var target=visual.targets(visual.runs(1L).getFirst().id()).getFirst();
        assertThat(target.status()).isEqualTo("REVIEW_REQUIRED");assertThat(target.seed().approved()).isFalse();assertThat(target.seed().sendResume()).isFalse();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();verify(qq).notifyProposal(any());
    }
    @Test void visualPauseResumeWorksWithoutEnablingAutomaticDuty() {
        service.start(startRequest(targets,true));assertThat(policies.policy(1L).enabled()).isFalse();
        assertThat(service.qqControl(1L,false)).isTrue();assertThat(visual.runs(1L).getFirst().status()).isEqualTo("PAUSED");
        assertThat(service.qqControl(1L,true)).isTrue();assertThat(visual.runs(1L).getFirst().status()).isEqualTo("RUNNING");
        assertThat(policies.policy(1L).enabled()).isFalse();verify(worker).cancel();
    }
    @Test void repeatedWordsAtANewTimeDoNotInheritApproval() {
        service.start(startRequest(targets,true));var old=captures.getFirst();
        nextCapture(new ChatCapture("new",0,old.session(),List.of(old.messages().getFirst(),new ChatMessage("对方","文本","你好","09-24 14:00")),false,true));
        when(ai.generate(any(),anyLong(),any(),any())).thenThrow(new IllegalStateException("AI offline"));advance();
        assertThat(visual.targets(visual.runs(1L).getFirst().id()).getFirst().seed().approved()).isFalse();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();verify(qq).notifyProposal(any());
    }
    @Test void otherJobCannotReplaceApprovedJob() {
        service.start(startRequest(targets,true));var old=captures.getFirst();
        var session=new ChatSession(old.session().uid(),"",old.session().hrName(),old.session().companyName(),"另一个职位","","你好","09-23 14:00");
        nextCapture(new ChatCapture("new",0,session,old.messages(),false,true));advance();
        assertThat(visual.runs(1L).getFirst().status()).isEqualTo("BLOCKED");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();
    }
}
