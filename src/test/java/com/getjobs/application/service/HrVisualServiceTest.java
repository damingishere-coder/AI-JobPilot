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
    HrVisualBatchStore batches;
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
        batches=new HrVisualBatchStore(db,crypto,json);
        when(worker.exchange(anyMap(),any(),any())).thenAnswer(inv->worker.exchange(inv.getArgument(0),inv.getArgument(1)));
        service=new HrVisualService(visual,store,policies,ai,worker,new HrProfileGuard(),profiles,qq,json,new TransactionTemplate(new DataSourceTransactionManager(ds)),batches);
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
    @Test void resumeRuleRequiresSeparateConsentAndLeavesTextPolicyUnchanged() {
        assertThat(visual.resumeRuleActive(1L)).isFalse();
        var request=new ResumeRuleRequest(1L,HrVisualTypes.PROTOCOL,true,false,"登录姓名",true);
        assertThatThrownBy(()->service.configureResumeRule(request)).hasMessageContaining("明确授权");
        var before=policies.policy(1L);
        service.configureResumeRule(new ResumeRuleRequest(1L,HrVisualTypes.PROTOCOL,true,true,"登录姓名",true));
        assertThat(visual.resumeRuleActive(1L)).isTrue();
        assertThat(policies.policy(1L)).isEqualTo(before);
        service.configureResumeRule(new ResumeRuleRequest(1L,HrVisualTypes.PROTOCOL,false,false,"",false));
        assertThat(visual.resumeRuleActive(1L)).isFalse();
    }
    @Test void resumeRuleQueuesOnlyResumeAfterPriorTextAndDeduplicatesAcrossScans() {
        service.configureResumeRule(new ResumeRuleRequest(1L,HrVisualTypes.PROTOCOL,true,true,"登录姓名",true));
        var contact=json.valueToTree(Map.of("hrName","HR0","companyName","公司0","previewKey","p1"));
        visual.discoveredResumeContacts(1L,json.valueToTree(List.of(contact)));
        var request=Map.of("text","我想要一份您的附件简历，您是否同意","type","其他","time","09-23 14:00");
        var messages=List.of(new ChatMessage("本人","文本","上轮","09-22 11:00"),new ChatMessage("对方","其他",request.get("text"),request.get("time")),new ChatMessage("本人","文本","已经回复过的文字","今天"));
        var capture=Map.of("hrName","HR0","companyName","公司0","jobName","岗位0","contextComplete",true,"messages",messages);
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(Map.of("ok",true,"capture",capture,"resumeRequest",request,"composer","")));
        ReflectionTestUtils.invokeMethod(service,"scanResumeRule",1L);
        verify(worker).exchange(argThat(m->"inspect".equals(m.get("operation")) && Boolean.TRUE.equals(m.get("existingChatOnly"))),isNull());
        var run=visual.runs(1L).getFirst();var target=visual.targets(run.id()).getFirst();
        assertThat(visual.isResumeRuleRun(run.id())).isTrue();
        assertThat(visual.steps(target.proposalId())).hasSize(1).allMatch(s->s.get("action_type").equals("RESUME_NATIVE"));
        assertThat(visual.resumeRuleAuthorized(1L,run.id())).isTrue();
        var after=new ArrayList<>(messages);after.add(new ChatMessage("本人","简历","本人简历.pdf","今天"));
        when(worker.exchange(anyMap(),notNull())).thenAnswer(inv->{
            Map<String,Object> payload=inv.getArgument(0);
            assertThat(payload.get("actionType")).isEqualTo("RESUME_NATIVE");
            assertThat(payload.get("ownTexts")).isEqualTo(List.of("已经回复过的文字"));
            java.util.function.Function<com.fasterxml.jackson.databind.JsonNode,Boolean> authorize=inv.getArgument(1);
            assertThat(authorize.apply(json.valueToTree(Map.of("capture",capture)))).isTrue();
            return json.valueToTree(Map.of("ok",true,"outcome","SENT_CONFIRMED","capture",Map.of("hrName","HR0","companyName","公司0","jobName","岗位0","contextComplete",true,"messages",after)));
        });
        advance();advance();
        assertThat(store.requireProposal(1L,target.proposalId()).status()).isEqualTo(ProposalStatus.SENT_CONFIRMED);
        visual.discoveredResumeContacts(1L,json.valueToTree(List.of(Map.of("hrName","HR0","companyName","公司0","previewKey","changed-read-badge"))));
        ReflectionTestUtils.invokeMethod(service,"scanResumeRule",1L);
        assertThat(visual.runs(1L)).hasSize(1);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_resume_rule_attempt",Integer.class)).isEqualTo(1);
    }
    @Test void visualOnlyIdentityIsSeparateFromPlatformUid() {
        var observed=new ChatSession("","","新HR","新公司","新岗位","","请发简历","");
        var resolved=store.resolveVisualSession(1L,observed);
        assertThat(resolved.uid()).startsWith("visual:");
        long id=store.upsertVisualConversation(1L,resolved);
        assertThat(db.queryForObject("SELECT platform FROM hr_conversation WHERE id=?",String.class,id)).isEqualTo("boss_visual");
        assertThat(store.resolveVisualSession(1L,observed).uid()).isEqualTo(resolved.uid());
        var changed=new ChatSession("","","新HR","新公司","不同岗位","","请发简历","");
        assertThatThrownBy(()->store.resolveVisualSession(1L,changed)).hasMessageContaining("未新建身份");
        store.markFinal(targets.getFirst().proposalId(),ProposalStatus.SEND_UNKNOWN,"未知发送不能用更名绕过");
        assertThatThrownBy(()->store.resolveVisualSession(1L,new ChatSession("","","更名HR","更名公司","岗位","","请发简历","")))
                .hasMessageContaining("无法排除联系人更名");
    }
    @Test void uiPauseAlsoPausesResumeRuleAndRevokesPendingAuthorization() {
        service.configureResumeRule(new ResumeRuleRequest(1L,HrVisualTypes.PROTOCOL,true,true,"登录姓名",true));
        service.start(startRequest(targets,true));
        var run=visual.runs(1L).getFirst();
        visual.recordResumeAttempt(1L,visual.targets(run.id()).getFirst().conversationId(),"fixture",run.id(),Map.of("text","请发简历"));
        assertThat(visual.resumeRuleAuthorized(1L,run.id())).isTrue();
        service.control(1L,run.id(),false);
        assertThat(visual.resumeRuleActive(1L)).isFalse();
        assertThat(visual.resumeRuleAuthorized(1L,run.id())).isFalse();
        assertThat(visual.resumeRule(1L).get("state")).isEqualTo("PAUSED");
        service.configureResumeRule(new ResumeRuleRequest(1L,HrVisualTypes.PROTOCOL,true,true,"登录姓名",true));
        assertThat(visual.resumeRuleAuthorized(1L,run.id())).isFalse();
    }
    BatchRequest batchRequest(){return new BatchRequest(1L,HrVisualTypes.PROTOCOL,"test-once-request-001","登录姓名",true,true);}
    void advanceBatch(){ReflectionTestUtils.invokeMethod(service,"advanceBatch",1L);}
    void discoverBatch(List<Map<String,Object>> contacts,boolean complete) {
        var b=batches.latest(1L);batches.state(b.id(),"RUNNING","DISCOVER","");
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(Map.of("ok",true,"contacts",contacts,"coverageComplete",complete,"coverage",complete?"END_CONFIRMED":"NO_PROGRESS","cursor",Map.of("anchor","x"))));
        advanceBatch();
        if(complete && batches.latest(1L).stage().equals("DISCOVER"))advanceBatch();
    }
    @Test void singlePassStartupIsIdempotentAndNeverReopensAfterFailureOrRestart() {
        service.startBatch(batchRequest());service.startBatch(batchRequest());
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_visual_batch",Integer.class)).isEqualTo(1);
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(Map.of("ok",false,"code","CHAT_TAB_MISSING","detail","未找到标签")));
        advanceBatch();
        verify(worker).exchange(argThat(m->"bootstrap".equals(m.get("operation")) && Boolean.TRUE.equals(m.get("allowOpenOnce"))),isNull());
        var b=batches.latest(1L);assertThat(b.status()).isEqualTo("PAUSED");
        assertThat(json.valueToTree(batches.observation(1L)).path("current").path("errorCode").asText()).isEqualTo("CHAT_TAB_MISSING");
        service.controlBatch(1L,b.id(),true);advanceBatch();
        verify(worker).exchange(argThat(m->"bootstrap".equals(m.get("operation")) && Boolean.FALSE.equals(m.get("allowOpenOnce"))),isNull());
        assertThat(db.queryForObject("SELECT open_reserved FROM hr_visual_batch",Integer.class)).isEqualTo(1);
    }
    @Test void incompleteCoverageCannotBecomeCompletedAndDiscoveryStops() {
        service.startBatch(batchRequest());
        for(int i=0;i<3;i++)discoverBatch(List.of(),false);
        assertThat(batches.latest(1L).stage()).isEqualTo("PROCESS");
        advanceBatch();assertThat(batches.latest(1L).status()).isEqualTo("INCOMPLETE");
        clearInvocations(worker);advanceBatch();verifyNoInteractions(worker);
    }
    @Test void batchKeepsTruncatedContactsAndExcludesPriorThreeConversations() {
        service.start(startRequest(targets,true));var original=visual.runs(1L).getFirst();visual.state(original.id(),"COMPLETED","");
        service.startBatch(batchRequest());
        discoverBatch(List.of(Map.of("hrName","HR0","companyName","公司0","identityComplete",true),Map.of("hrName","王女士","companyName","公司…","identityComplete",false)),true);
        advanceBatch();advanceBatch();advanceBatch();
        assertThat(batches.status(1L).get("checked")).isEqualTo(0L);
        assertThat(batches.latest(1L).status()).isEqualTo("INCOMPLETE");
        assertThat(batches.items(batches.latest(1L).id()).stream().filter(i->i.kind().equals("CONTACT")).map(HrVisualBatchStore.Item::status)).containsExactly("EXCLUDED","BLOCKED");
    }
    HrVisualBatchStore.Item preparePriority() {
        service.startBatch(batchRequest());
        discoverBatch(List.of(Map.of("hrName","新HR","companyName","新公司","identityComplete",true),
                Map.of("hrName","另一HR","companyName","另一公司","identityComplete",true)),false);
        var b=batches.latest(1L);batches.reserveOpen(b.id());service.controlBatch(1L,b.id(),false);
        return batches.items(b.id()).stream().filter(i->i.kind().equals("CONTACT")).findFirst().orElseThrow();
    }
    void positionPriority() {
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(Map.of("ok",true,"contacts",List.of(),"listTopVerified",true,"coverageComplete",false)));
        advanceBatch();assertThat(batches.latest(1L).stage()).isEqualTo("ANCHORS");
    }
    void priorityObservation(boolean resume) {
        String now=java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"))+" 10:00";
        var descriptor=Map.of("text",resume?"方便发一份附件简历吗":"你好","time",now,"type","文本");
        var capture=Map.of("hrName","新HR","companyName","新公司","jobName","岗位","contextComplete",true,
                "messages",List.of(new ChatMessage("本人","文本","上轮",now),new ChatMessage("对方","文本",descriptor.get("text"),now)));
        var response=new LinkedHashMap<String,Object>(Map.of("ok",true,"capture",capture,"composer",""));
        if(resume)response.put("resumeRequest",descriptor);
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(response));
    }
    @Test void priorityResumeIsBatchOwnedIdempotentAndRestartsDiscoveryWithoutReopening() {
        var item=preparePriority();String id=item.batch();
        service.prioritizeBatchItem(1L,id,item.id());service.prioritizeBatchItem(1L,id,item.id());
        assertThat(batches.latest(1L).stage()).isEqualTo("POSITION_LIST");positionPriority();
        advanceBatch();assertThat(batches.latest(1L).stage()).isEqualTo("PROCESS_PRIORITY");
        priorityObservation(true);advanceBatch();
        var run=visual.runs(1L).getFirst();var target=visual.targets(run.id()).getFirst();
        assertThat(batches.owner(run.id())).isEqualTo(id);
        assertThat(visual.steps(target.proposalId())).hasSize(1).allMatch(s->s.get("action_type").equals("RESUME_NATIVE"));
        assertThat(batches.allows(1L,run.id())).isTrue();
        assertThat(visual.resumeRuleActive(1L)).isFalse();
        service.prioritizeBatchItem(1L,id,item.id());assertThat(visual.runs(1L)).hasSize(1);
        visual.state(run.id(),"COMPLETED","测试模拟发送已结束");advanceBatch();
        assertThat(batches.latest(1L).stage()).isEqualTo("DISCOVER");
        assertThat(batches.latest(1L).cursor()).isNull();assertThat(batches.latest(1L).coverage()).isFalse();
        assertThat(batches.items(id).get(1).status()).isEqualTo("PENDING");
        assertThat(db.queryForObject("SELECT open_reserved FROM hr_visual_batch",Integer.class)).isEqualTo(1);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_visual_batch",Integer.class)).isEqualTo(1);
        verify(worker,never()).exchange(argThat(m->m.containsKey("allowOpenOnce")),isNull());
    }
    @Test void unknownPrioritySendPausesBeforeAnotherDesktopOperation() {
        var item=preparePriority();service.prioritizeBatchItem(1L,item.batch(),item.id());positionPriority();advanceBatch();
        priorityObservation(true);advanceBatch();
        var run=visual.runs(1L).getFirst();var target=visual.targets(run.id()).getFirst();
        var step=visual.claim(1L,target.proposalId());
        ReflectionTestUtils.invokeMethod(service,"finish",run,target,step,"SEND_UNKNOWN",Map.of("detail","没有新增回执"));
        assertThat(batches.latest(1L).status()).isEqualTo("PAUSED");
        assertThat(store.requireProposal(1L,target.proposalId()).status()).isEqualTo(ProposalStatus.SEND_UNKNOWN);
        clearInvocations(worker);advance();advanceBatch();
        verify(worker,never()).exchange(anyMap(),any());
        verify(worker,never()).exchange(anyMap(),any(),any());
        assertThat(visual.steps(target.proposalId())).hasSize(1);
    }
    @Test void priorityTextStillWaitsForQqAndResumeSurvivesRestart() {
        var item=preparePriority();service.prioritizeBatchItem(1L,item.batch(),item.id());positionPriority();advanceBatch();
        batches.recover();service.controlBatch(1L,item.batch(),true);advanceBatch();
        assertThat(batches.latest(1L).stage()).isEqualTo("PROCESS_PRIORITY");
        priorityObservation(false);
        when(ai.generate(anyLong(),anyLong(),any(),any())).thenReturn(new AiDraft(Classification.REPLY,"您好","",List.of(),List.of(),1));
        when(ai.assess(anyLong(),anyLong(),any(),any())).thenReturn(new HrAutopilotService.Assessment("TEXT","已审核","您好"));
        advanceBatch();var run=visual.runs(1L).getFirst();
        assertThat(run.status()).isEqualTo("WAITING_REVIEW");assertThat(visual.steps(visual.targets(run.id()).getFirst().proposalId())).isEmpty();
        verify(qq).notifyProposal(any());advanceBatch();assertThat(batches.latest(1L).stage()).isEqualTo("DISCOVER");
    }
    @Test void priorityCannotBypassUnknownIdentityOrRequeueBlockedRead() {
        store.markFinal(targets.getFirst().proposalId(),ProposalStatus.SEND_UNKNOWN,"旧未知");
        var item=preparePriority();String id=item.batch();
        service.prioritizeBatchItem(1L,id,item.id());
        positionPriority();
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(Map.of("ok",false,"code","BODY_INCOMPLETE","detail","旧未知正文未核验")));
        advanceBatch();advanceBatch();priorityObservation(true);advanceBatch();
        assertThat(batches.items(id).stream().filter(i->i.id().equals(item.id())).findFirst().orElseThrow().status()).isEqualTo("BLOCKED");
        assertThat(visual.runs(1L)).isEmpty();assertThat(store.requireProposal(1L,targets.getFirst().proposalId()).status()).isEqualTo(ProposalStatus.SEND_UNKNOWN);
        service.prioritizeBatchItem(1L,id,item.id());assertThat(visual.runs(1L)).isEmpty();
    }
    @Test void interruptedTopPositioningResumesWithoutClaimingCoverageOrReopening() {
        var item=preparePriority();service.prioritizeBatchItem(1L,item.batch(),item.id());
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(Map.of("ok",true,"contacts",List.of(),"coverage","SEEKING_TOP","cursor",Map.of("seekingTop",true),"listTopVerified",false)));
        advanceBatch();assertThat(batches.latest(1L).stage()).isEqualTo("POSITION_LIST");assertThat(batches.latest(1L).coverage()).isFalse();
        batches.recover();service.controlBatch(1L,item.batch(),true);advanceBatch();
        assertThat(batches.latest(1L).stage()).isEqualTo("POSITION_LIST");
        assertThat(batches.afterAnchors(item.batch())).isEqualTo("PROCESS_PRIORITY");
        positionPriority();advanceBatch();assertThat(batches.latest(1L).stage()).isEqualTo("PROCESS_PRIORITY");
        assertThat(db.queryForObject("SELECT open_reserved FROM hr_visual_batch",Integer.class)).isEqualTo(1);
    }
    @Test void explicitRecheckCanOnlyRetryPreflightWithoutAnySendRun() {
        var item=preparePriority();batches.outcome(item.id(),"BLOCKED","存在未核验发送，无法排除联系人更名；新视觉身份暂不自动分享简历");
        service.recheckBatchItem(1L,item.batch(),item.id());positionPriority();advanceBatch();priorityObservation(true);advanceBatch();
        var run=visual.runs(1L).getFirst();var t=visual.targets(run.id()).getFirst();
        visual.target(t.id(),null,"SEND_UNKNOWN","模拟未知");visual.state(run.id(),"COMPLETED","");advanceBatch();service.controlBatch(1L,item.batch(),false);
        service.recheckBatchItem(1L,item.batch(),item.id());
        assertThat(batches.latest(1L).status()).isEqualTo("PAUSED");assertThat(visual.runs(1L)).hasSize(1);
        assertThat(visual.targets(run.id()).getFirst().status()).isEqualTo("SEND_UNKNOWN");
    }
    @Test void priorityRejectsActiveScanWrongProfileAndExcludedContacts() {
        var item=preparePriority();String id=item.batch();
        assertThatThrownBy(()->service.prioritizeBatchItem(1L,id,"not-in-batch")).hasMessageContaining("不属于");
        when(profiles.getCurrentProfileId()).thenReturn(2L);
        assertThatThrownBy(()->service.prioritizeBatchItem(1L,id,item.id())).hasMessageContaining("档案");
        when(profiles.getCurrentProfileId()).thenReturn(1L);
        batches.state(id,"RUNNING","DISCOVER","");
        assertThatThrownBy(()->service.prioritizeBatchItem(1L,id,item.id())).hasMessageContaining("暂停");
        batches.state(id,"PAUSED","DISCOVER","");batches.add(id,"EXCLUDED",item.contact(),null);
        assertThatThrownBy(()->service.prioritizeBatchItem(1L,id,item.id())).hasMessageContaining("排除");
        assertThat(batches.latest(1L).status()).isEqualTo("PAUSED");
    }
    @Test void batchResumeOnlyUsesScopedConsentAndDoesNotEnableContinuousRule() {
        service.startBatch(batchRequest());
        discoverBatch(List.of(Map.of("hrName","新HR","companyName","新公司","identityComplete",true)),true);
        String now=java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"))+" 10:00";
        var descriptor=Map.of("text","方便发一份附件简历吗","time",now,"type","文本");
        var messages=List.of(new ChatMessage("本人","文本","上轮",now),new ChatMessage("对方","文本",descriptor.get("text"),now));
        var capture=Map.of("hrName","新HR","companyName","新公司","jobName","岗位","contextComplete",true,"messages",messages);
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(Map.of("ok",true,"capture",capture,"composer","","resumeRequest",descriptor)));
        advanceBatch();
        var run=visual.runs(1L).getFirst();var t=visual.targets(run.id()).getFirst();
        assertThat(visual.steps(t.proposalId())).hasSize(1).allMatch(s->s.get("action_type").equals("RESUME_NATIVE"));
        assertThat(visual.resumeRuleActive(1L)).isFalse();assertThat(batches.resumeRequest(run.id())).isNotNull();
        service.controlBatch(1L,batches.latest(1L).id(),false);
        assertThat(batches.allows(1L,run.id())).isFalse();
        assertThat(store.requireProposal(1L,t.proposalId()).status()).isEqualTo(ProposalStatus.APPROVED);
    }
    @Test void anchoredUnknownMayAllowDistinctIdentityButUnknownAndNewUnknownRemainHeld() {
        long old=store.requireProposal(1L,targets.getFirst().proposalId()).conversationId();
        store.markFinal(targets.getFirst().proposalId(),ProposalStatus.SEND_UNKNOWN,"未知");
        var different=new ChatSession("","","其他HR","其他公司","其他岗位","","请发简历","今天");
        assertThatThrownBy(()->store.resolveVisualSession(1L,different)).hasMessageContaining("无法排除");
        assertThat(store.resolveVisualSession(1L,different,Set.of(old)).uid()).startsWith("visual:");
        assertThatThrownBy(()->store.resolveVisualSession(1L,captures.get(1).session())).hasMessageContaining("无法排除");
        assertThat(policies.conversationHeld(old)).isTrue();
        store.markFinal(targets.get(1).proposalId(),ProposalStatus.SEND_UNKNOWN,"新未知");
        assertThatThrownBy(()->store.resolveVisualSession(1L,different,Set.of(old))).hasMessageContaining("无法排除");
    }
    @Test void failedObservationKeepsLastSuccessfulObservationWithItsOriginalTimestamp() {
        batches.observation(1L,json.valueToTree(Map.of("stage","LIST_READY_NO_SELECTION","observedAt",1000,"detail","列表已加载，未选择 HR")));
        batches.observation(1L,json.valueToTree(Map.of("stage","OBSERVATION_FAILED","observedAt",2000,"detail","无法读取")));
        var view=json.valueToTree(batches.observation(1L));
        assertThat(view.path("current").path("stage").asText()).isEqualTo("OBSERVATION_FAILED");
        assertThat(view.path("lastSuccess").path("observedAt").asInt()).isEqualTo(1000);
    }
    @Test void batchQueuesTextOnlyAfterQqConfirmationEvenAfterScanningFinishes() {
        policies.configure(1L,1,false,"","");
        db.update("UPDATE hr_autopilot_policy SET paused=1 WHERE profile_id=1");
        service.startBatch(batchRequest());
        discoverBatch(List.of(Map.of("hrName","新HR","companyName","新公司","identityComplete",true)),true);
        String now=java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"))+" 10:00";
        var messages=List.of(new ChatMessage("本人","文本","上轮",now),new ChatMessage("对方","文本","你好",now));
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(Map.of("ok",true,"capture",Map.of("hrName","新HR","companyName","新公司","jobName","岗位","contextComplete",true,"messages",messages),"composer","")));
        when(ai.generate(anyLong(),anyLong(),any(),any())).thenReturn(new AiDraft(Classification.REPLY,"您好，请介绍一下工作内容。","岗位追问",List.of(),List.of(),1));
        when(ai.assess(anyLong(),anyLong(),any(),any())).thenReturn(new HrAutopilotService.Assessment("TEXT","已审核","您好，请介绍一下工作内容。"));
        advanceBatch();
        var run=visual.runs(1L).getFirst();var t=visual.targets(run.id()).getFirst();
        assertThat(run.status()).isEqualTo("WAITING_REVIEW");assertThat(visual.steps(t.proposalId())).isEmpty();
        verify(qq).notifyProposal(any());
        advanceBatch();assertThat(batches.latest(1L).status()).isEqualTo("FINISHED");
        service.queue(1L,t.proposalId(),1);
        assertThat(visual.steps(t.proposalId())).hasSize(1).allMatch(s->"TEXT".equals(s.get("action_type")));
        assertThatThrownBy(()->service.queue(1L,t.proposalId(),1)).hasMessageContaining("已排队");
        assertThat(batches.latest(1L).status()).isEqualTo("FINISHED");
        assertThat(policies.policy(1L).paused()).isTrue();
    }
    @Test void pageGapCannotBeOverwrittenByLaterEndMarkerAndRestartRequiresResume() {
        service.startBatch(batchRequest());String id=batches.latest(1L).id();
        batches.page(id,json.valueToTree(Map.of("contacts",List.of(),"coverageGap",true,"cursor",Map.of())));
        batches.page(id,json.valueToTree(Map.of("contacts",List.of(),"coverageComplete",true,"cursor",Map.of())));
        assertThat(batches.latest(1L).coverage()).isFalse();
        batches.recover();assertThat(batches.latest(1L).status()).isEqualTo("PAUSED");
        assertThat(batches.active(1L)).isFalse();
    }
    @Test void reorderedListWithOverlappingPagesCannotClaimCompleteCoverage() {
        service.startBatch(batchRequest());String id=batches.latest(1L).id();
        var a=Map.of("hrName","甲","companyName","公司","previewKey","1");
        var b=Map.of("hrName","乙","companyName","公司","previewKey","2");
        batches.page(id,json.valueToTree(Map.of("contacts",List.of(a,b),"coverageComplete",true,"cursor",Map.of())));
        assertThat(batches.confirmDiscovery(id)).isFalse();
        batches.page(id,json.valueToTree(Map.of("contacts",List.of(b,a),"coverageComplete",true,"cursor",Map.of())));
        assertThat(batches.confirmDiscovery(id)).isTrue();assertThat(batches.latest(1L).coverage()).isFalse();
    }
    @Test void sameIdentityReappearingOutsideAdjacentViewportRemainsBlocked() {
        service.startBatch(batchRequest());String id=batches.latest(1L).id();
        var a=Map.of("hrName","甲","companyName","公司","previewKey","1");
        var b=Map.of("hrName","乙","companyName","公司","previewKey","2");
        var c=Map.of("hrName","丙","companyName","公司","previewKey","3");
        batches.page(id,json.valueToTree(Map.of("contacts",List.of(a,b),"cursor",Map.of("keys",List.of("甲|公司","乙|公司")))));
        batches.page(id,json.valueToTree(Map.of("contacts",List.of(b,c),"cursor",Map.of("keys",List.of("乙|公司","丙|公司")))));
        batches.page(id,json.valueToTree(Map.of("contacts",List.of(c,a),"coverageComplete",true,"cursor",Map.of("keys",List.of("丙|公司","甲|公司")))));
        assertThat(batches.items(id).stream().filter(i->i.contact().path("hrName").asText().equals("甲")).findFirst().orElseThrow().status()).isEqualTo("BLOCKED");
        assertThat(batches.latest(1L).coverage()).isFalse();
    }
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

    @Test void reconfirmationRequiresFreshHumanConsentAndKeepsUnknownReceipt() {
        service.start(startRequest(targets,true));
        for(var c:captures){nextCapture(c);advance();}
        var run=visual.runs(1L).getFirst();var target=visual.targets(run.id()).getFirst();
        var step=visual.claim(1L,target.proposalId());visual.submitting(step);
        visual.finish(step,"SEND_UNKNOWN",Map.of("detail","fixture uncertainty"));
        visual.completeParent(step.commandId(),"SEND_UNKNOWN");store.markFinal(target.proposalId(),ProposalStatus.SEND_UNKNOWN,"fixture uncertainty");
        visual.target(target.id(),null,"SEND_UNKNOWN","");visual.state(run.id(),"PAUSED","");
        var old=store.requireProposal(1L,target.proposalId());nextCapture(captures.getFirst());
        assertThatThrownBy(()->service.reconfirm(1L,run.id(),target.id(),new ReconfirmRequest(old.id(),old.version(),old.draft(),true,false)))
                .hasMessageContaining("不能自动重试");
        var review=new ReconfirmRequest(old.id(),old.version(),old.draft(),true,true);
        service.reconfirm(1L,run.id(),target.id(),review);
        var next=visual.targets(run.id()).getFirst();
        assertThat(next.proposalId()).isNotEqualTo(old.id());
        assertThat(visual.explicitlyReconfirmed(next.proposalId())).isTrue();
        assertThat(visual.run(1L,run.id()).status()).isEqualTo("PAUSED");
        assertThat(store.requireProposal(1L,old.id()).status()).isEqualTo(ProposalStatus.SEND_UNKNOWN);
        assertThat(visual.steps(old.id()).getFirst().get("status")).isEqualTo("SEND_UNKNOWN");
        assertThat(visual.previousAttempts(target.id())).hasSize(2);
        assertThatThrownBy(()->service.reconfirm(1L,run.id(),target.id(),review)).hasMessageContaining("已被新版本替代");
        store.markFinal(next.proposalId(),ProposalStatus.BLOCKED,"second attempt blocked before submission");
        var blocked=store.requireProposal(1L,next.proposalId());
        assertThatThrownBy(()->service.reconfirm(1L,run.id(),target.id(),new ReconfirmRequest(blocked.id(),blocked.version(),blocked.draft(),true,false)))
                .hasMessageContaining("不能自动重试");
    }

    @Test void reconfirmationRejectsAnAlreadyObservedReply() {
        service.start(startRequest(targets,true));
        for(var c:captures){nextCapture(c);advance();}
        var run=visual.runs(1L).getFirst();var target=visual.targets(run.id()).getFirst();
        store.markFinal(target.proposalId(),ProposalStatus.BLOCKED,"fixture");visual.state(run.id(),"PAUSED","");
        var old=store.requireProposal(1L,target.proposalId());var before=captures.getFirst();
        var messages=new ArrayList<>(before.messages());messages.add(new ChatMessage("本人","文本",old.draft(),"今天"));
        nextCapture(new ChatCapture("new",0,before.session(),messages,false,true));
        assertThatThrownBy(()->service.reconfirm(1L,run.id(),target.id(),new ReconfirmRequest(old.id(),old.version(),old.draft(),true,false)))
                .hasMessageContaining("出现本人回复");
        assertThat(visual.explicitlyReconfirmed(old.id())).isFalse();
    }
    @Test void resumeOnlyReconfirmationNeverCreatesATextStepOrRepeatsUnknownAutomatically() {
        var item=preparePriority();service.prioritizeBatchItem(1L,item.batch(),item.id());positionPriority();advanceBatch();
        priorityObservation(true);advanceBatch();
        var run=visual.runs(1L).getFirst();var target=visual.targets(run.id()).getFirst();
        var step=visual.claim(1L,target.proposalId());visual.submitting(step);
        ReflectionTestUtils.invokeMethod(service,"finish",run,target,step,"SEND_UNKNOWN",Map.of("detail","回执缺失"));advance();
        var old=store.requireProposal(1L,target.proposalId());
        assertThatThrownBy(()->service.reconfirm(1L,run.id(),target.id(),new ReconfirmRequest(old.id(),old.version(),old.draft(),true,false)))
                .hasMessageContaining("不能自动重试");
        priorityObservation(false);
        assertThatThrownBy(()->service.reconfirm(1L,run.id(),target.id(),new ReconfirmRequest(old.id(),old.version(),old.draft(),true,true)))
                .hasMessageContaining("本轮消息已变化");
        assertThat(visual.steps(old.id())).hasSize(1);
        var fresh=target.seed().expected();
        var capture=Map.of("hrName",target.seed().hrName(),"companyName",target.seed().companyName(),"jobName",target.seed().jobName(),"contextComplete",true,"messages",fresh.messages());
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(Map.of("ok",true,"capture",capture,"composer","")));
        assertThatThrownBy(()->service.reconfirm(1L,run.id(),target.id(),new ReconfirmRequest(old.id(),old.version(),old.draft(),true,true)))
                .hasMessageContaining("简历请求已失效");
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(Map.of("ok",true,"capture",capture,"composer",old.draft(),"resumeRequest",batches.resumeRequest(run.id()))));
        assertThatThrownBy(()->service.reconfirm(1L,run.id(),target.id(),new ReconfirmRequest(old.id(),old.version(),old.draft(),true,true)))
                .hasMessageContaining("人工草稿");
        priorityObservation(true);
        service.reconfirm(1L,run.id(),target.id(),new ReconfirmRequest(old.id(),old.version(),old.draft(),true,true));
        var next=visual.targets(run.id()).getFirst();
        assertThat(next.proposalId()).isNotEqualTo(old.id());
        assertThat(visual.steps(next.proposalId())).hasSize(1).allMatch(s->s.get("action_type").equals("RESUME_NATIVE"));
        assertThat(visual.steps(old.id()).getFirst().get("status")).isEqualTo("SEND_UNKNOWN");
        assertThat(visual.run(1L,run.id()).status()).isEqualTo("PAUSED");
        assertThat(batches.latest(1L).status()).isEqualTo("PAUSED");
        assertThat(visual.resumeRuleActive(1L)).isFalse();
        assertThatThrownBy(()->service.reconfirm(1L,run.id(),target.id(),new ReconfirmRequest(old.id(),old.version(),old.draft(),true,true)))
                .hasMessageContaining("已被新版本替代");
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(ints={0,1})
    void readonlyReconciliationPreservesUnknownAuditAndCannotQueueOrRepeat(int targetIndex) {
        service.start(startRequest(targets,true));
        for(var c:captures){nextCapture(c);advance();}
        var run=visual.runs(1L).getFirst();var target=visual.targets(run.id()).get(targetIndex);
        var step=visual.claim(1L,target.proposalId());visual.submitting(step);
        var before=captures.get(targetIndex);
        var baseline=Map.of("hrName",before.session().hrName(),"companyName",before.session().companyName(),"jobName",before.session().jobName(),"messages",before.messages(),"contextComplete",true);
        visual.finish(step,"SEND_UNKNOWN",Map.of("submitted",true,"before",baseline,"detail","selection reordered"));
        visual.completeParent(step.commandId(),"SEND_UNKNOWN");store.markFinal(target.proposalId(),ProposalStatus.SEND_UNKNOWN,"selection reordered");
        visual.target(target.id(),null,"SEND_UNKNOWN","");visual.state(run.id(),"PAUSED","");
        var original=visual.stepEvidence(step.id());
        var after=new ArrayList<>(before.messages());after.add(new ChatMessage("本人","文本","您好","12:03"));
        var reply=Map.of("ok",true,"outcome","SENT_CONFIRMED","capture",Map.of("hrName",before.session().hrName(),"companyName",before.session().companyName(),"jobName",before.session().jobName(),"messages",after,"contextComplete",true));
        var mismatch=json.valueToTree(reply);
        ((com.fasterxml.jackson.databind.node.ObjectNode)mismatch.path("capture").path("messages").get(2)).put("text","相似但不同的回复");
        when(worker.exchange(anyMap(),isNull())).thenReturn(mismatch);
        assertThatThrownBy(()->service.reconcile(1L,run.id(),target.id())).hasMessageContaining("不匹配");
        assertThat(store.requireProposal(1L,target.proposalId()).status()).isEqualTo(ProposalStatus.SEND_UNKNOWN);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_visual_receipt_review",Integer.class)).isZero();
        when(worker.exchange(anyMap(),isNull())).thenReturn(json.valueToTree(reply));
        service.reconcile(1L,run.id(),target.id());
        assertThat(store.requireProposal(1L,target.proposalId()).status()).isEqualTo(targetIndex==0?ProposalStatus.APPROVED:ProposalStatus.SENT_CONFIRMED);
        assertThat(visual.steps(target.proposalId()).getFirst().get("reviewed_at")).isNotNull();
        assertThat(db.queryForObject("SELECT previous_status FROM hr_visual_receipt_review WHERE step_id=?",String.class,step.id())).isEqualTo("SEND_UNKNOWN");
        assertThat(db.queryForObject("SELECT original_evidence_cipher FROM hr_visual_receipt_review WHERE step_id=?",String.class,step.id())).isNotBlank();
        assertThat(original.path("detail").asText()).isEqualTo("selection reordered");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isEqualTo(3);
        assertThat(visual.run(1L,run.id()).status()).isEqualTo("PAUSED");
        verify(worker,times(2)).exchange(argThat(m->"reconcile".equals(m.get("operation"))),isNull());
        assertThatThrownBy(()->service.reconcile(1L,run.id(),target.id())).hasMessageContaining("没有待核验");
        if(targetIndex==0) {
            assertThat(visual.targets(run.id()).getFirst().status()).isEqualTo("PARTIAL");
            assertThat(visual.steps(target.proposalId()).get(1).get("status")).isEqualTo("PENDING");
            service.control(1L,run.id(),true);
            db.update("UPDATE hr_send_step SET finished_at=0 WHERE id=?",step.id());
            var remaining=visual.claim(1L,target.proposalId());
            assertThat(remaining.actionType()).isEqualTo("RESUME_NATIVE");
            assertThat(remaining.ordinal()).isEqualTo(1);
        }
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
