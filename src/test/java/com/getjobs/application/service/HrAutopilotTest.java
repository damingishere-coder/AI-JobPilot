package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class HrAutopilotTest {
    @TempDir Path dir;
    JdbcTemplate jdbc;
    HrAssistantStore hr;
    HrAutopilotStore policies;
    HrAutopilotService service;
    HrReplyDraftService drafts;
    AiService ai;
    long conversation;
    CommunicationProfile communication = new CommunicationProfile("15-20K","深圳或广州","随时/两周","电话","13800138000","礼貌","不编造");

    @BeforeEach void setup() {
        var ds=new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("test.db"));
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        jdbc=new JdbcTemplate(ds);
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES (1,'测试',1),(2,'其他',0)");
        var json=new ObjectMapper(); var crypto=new HrAssistantCryptoService(dir.resolve("hr.key"));
        hr=new HrAssistantStore(jdbc,crypto,json);
        hr.saveSettings(1L,communication,true,"ws://127.0.0.1:3001","test-token",QqTargetType.GROUP,"987654321","123456",30);
        policies=new HrAutopilotStore(jdbc,json,crypto,hr);
        drafts=mock(HrReplyDraftService.class); ai=mock(AiService.class);
        service=new HrAutopilotService(policies,hr,drafts,ai,json,mock(HrMediaService.class));
        when(drafts.history(anyList())).thenAnswer(call->call.getArgument(0).toString());
        when(drafts.trustedFacts(eq(1L),any())).thenReturn("有三年运营经验，电话13800138000");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\": true, \"evidence\": [\"三年运营经验\"], \"reason\": \"事实有依据\", \"claims\": [{\"text\": \"三年运营经验\", \"quote\": \"三年运营经验\", \"entailed\": true}]}");
        conversation=hr.upsertConversation(1L,new ChatSession("uid","","测试HR","测试公司","运营","测试HR","",""));
        policies.configure(1L,1,true,"测试简历.pdf","a".repeat(64));
    }
    ChatCapture capture(String question, boolean historical, boolean complete) {
        return new ChatCapture("capture",1,new ChatSession("uid","","测试HR","测试公司","运营","测试HR",question,"今天"),
                List.of(new ChatMessage("本人","文本","您好","昨天","m1",List.of()),new ChatMessage("对方","文本",question,"今天","m2",List.of())),historical,complete);
    }
    AiDraft draft(Classification c,String text) {return new AiDraft(c,text,"摘要",List.of(),List.of(),0.99);}
    @Test void pureDeclineGeneratesOnlyTheUserAcknowledgmentAndStillRequiresIndependentAudit() {
        var c=capture("您好！感谢您的关注，岗位合适会跟您联系。",false,true);
        var d=service.generate(1L,conversation,communication,c);
        assertThat(d.classification()).isEqualTo(Classification.REPLY);
        assertThat(d.replyText()).isEqualTo("好的，谢谢");
        verify(drafts,never()).generateWithFacts(anyLong(),anyLong(),any(),anyList(),anyString());
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\":true,\"evidence\":[],\"reason\":\"礼貌回复\",\"claims\":[]}");
        assertThat(service.assess(1L,conversation,c,d).action()).isEqualTo("TEXT");
        verify(ai).sendStructuredRequest(contains("正文：好的，谢谢"),anyString());
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\":false,\"evidence\":[],\"reason\":\"需人工核验\",\"claims\":[]}");
        assertThat(service.assess(1L,conversation,c,d).action()).isEqualTo("HUMAN");
    }
    @Test void declineWithUnresolvedRequestUsesNormalGeneration() {
        var expected=draft(Classification.NEEDS_USER,"");
        when(drafts.generateWithFacts(anyLong(),anyLong(),any(),anyList(),anyString())).thenReturn(expected);
        var c=capture("很遗憾暂时没有适合您的岗位，请介绍您的淘宝运营经历",false,true);
        assertThat(service.generate(1L,conversation,communication,c)).isSameAs(expected);
        verify(drafts).generateWithFacts(eq(1L),eq(conversation),eq(communication),eq(c.messages()),anyString());
    }
    @Test void fixedAcknowledgmentCannotBypassAnUnknownSendHold() {
        var c=capture("很遗憾暂时没有适合您的岗位",false,true);
        var d=service.generate(1L,conversation,communication,c);
        long id=proposal(c,d);hr.markFinal(id,ProposalStatus.SEND_UNKNOWN,"未见回执");
        assertThat(service.assess(1L,conversation,c,d).action()).isEqualTo("HUMAN");
        verifyNoInteractions(ai);
    }
    long proposal(ChatCapture capture,AiDraft draft) {
        for(var m:capture.messages()) hr.saveMessage(conversation,m,30);
        String source=hr.sourceFingerprint(conversation,capture.messages().getLast()); hr.updateLastInbound(conversation,source);
        policies.context(conversation,capture);
        return hr.createProposal(1L,conversation,source,draft);
    }
    @Test void verifiedFactualReplyQueuesWithPolicyEvidence() {
        var capture=capture("您有什么工作经历",false,true);var draft=draft(Classification.REPLY,"我有三年运营经验。");
        long id=proposal(capture,draft);
        assertThat(service.apply(1L,id,conversation,capture,draft,"watch")).isFalse();
        assertThat(hr.getProposalView(1L,id).status()).isEqualTo("APPROVED");
        assertThat(policies.decision(id).automatic()).isTrue();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isEqualTo(1);
    }
    @Test void historicalMessagesNeverInvokeAuditOrQueue() {
        var capture=capture("您好",true,true);var draft=draft(Classification.REPLY,"您好");long id=proposal(capture,draft);
        assertThat(service.apply(1L,id,conversation,capture,draft,"watch")).isFalse();
        assertThat(hr.getProposalView(1L,id).status()).isEqualTo("SKIPPED");verifyNoInteractions(ai);
    }
    @Test void incompleteContextCannotAutoReplyEvenWithHighConfidence() {
        assertThat(service.assess(1L,conversation,capture("工作经验？",false,false),draft(Classification.REPLY,"有经验")).action()).isEqualTo("HUMAN");
        verifyNoInteractions(ai);
    }
    @Test void interviewOfferSensitiveAndUnapprovedSharingAlwaysNeedHuman() {
        for(String text:List.of("明天15:30来面试","身份证发一下","付费培训可以吗","可以降薪吗","加微信沟通","银行卡号给我","请签约合同"))
            assertThat(service.assess(1L,conversation,capture(text,false,true),draft(Classification.REPLY,"好的")).action()).as(text).isEqualTo("HUMAN");
        assertThat(service.assess(1L,conversation,capture("录用意向",false,true),draft(Classification.OFFER,"接受")).action()).isEqualTo("HUMAN");
    }
    @Test void phoneUsesConfiguredNumberOnlyWhenRequested() {
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn(audit("", "电话13800138000"));
        var result=service.assess(1L,conversation,capture("请留个电话",false,true),draft(Classification.CONTACT_REQUEST,"其他号码"));
        assertThat(result.action()).isEqualTo("PHONE");assertThat(result.draft()).contains("13800138000").doesNotContain("其他号码");
    }
    @Test void unsupportedEvidenceAndProviderFailureBothNeedHuman() {
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\": true, \"evidence\": [\"编造经历\"], \"reason\": \"好\", \"claims\": [{\"text\": \"编造经历\", \"quote\": \"编造经历\", \"entailed\": true}]}");
        assertThat(service.assess(1L,conversation,capture("经验？",false,true),draft(Classification.REPLY,"我很熟练")).action()).isEqualTo("HUMAN");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenThrow(new IllegalStateException("offline"));
        assertThat(service.assess(1L,conversation,capture("经验？",false,true),draft(Classification.REPLY,"我很熟练")).action()).isEqualTo("HUMAN");
    }
    @Test void settingsChangeInvalidatesPriorAutomaticAuthorization() {
        assertThat(policies.authorizationValid(1L)).isTrue();
        hr.saveSettings(1L,communication,true,"ws://127.0.0.1:3001","test-token",QqTargetType.GROUP,"987654321","234567",30);
        assertThat(policies.authorizationValid(1L)).isFalse();
        var capture=capture("经验？",false,true);var draft=draft(Classification.REPLY,"三年运营经验");long id=proposal(capture,draft);
        assertThat(service.apply(1L,id,conversation,capture,draft,"watch")).isTrue();
        assertThat(hr.getProposalView(1L,id).status()).isEqualTo("REVIEW_REQUIRED");
    }
    @Test void unknownSendHoldsTheConversation() {
        var c=capture("请回复",false,true);long id=proposal(c,draft(Classification.REPLY,"回复"));
        hr.markFinal(id,ProposalStatus.SEND_UNKNOWN,"结果未知");
        assertThat(service.assess(1L,conversation,c,draft(Classification.REPLY,"再次回复")).action()).isEqualTo("HUMAN");
    }
    @Test void revisedDraftRotatesCodeAndRejectsOldConfirmation() {
        long id=proposal(capture("你好",false,true),draft(Classification.REPLY,"您好"));var old=hr.getProposalView(1L,id);
        var revised=hr.revise(1L,id,old.version(),"谢谢");
        assertThat(revised.confirmationCode()).isNotEqualTo(old.confirmationCode());
        assertThatThrownBy(()->hr.requireProposalByCode(1L,old.confirmationCode())).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void originalMetadataRoundTripsAndStaysProfileScoped() {
        var c=capture("你好",false,true);proposal(c,draft(Classification.REPLY,"您好"));
        assertThat(hr.recentMessages(conversation,20).getLast().messageId()).isEqualTo("m2");
        assertThat(policies.context(1L,conversation).messages()).hasSize(2);
        assertThatThrownBy(()->policies.context(2L,conversation)).isInstanceOf(IllegalStateException.class);
        String raw=jdbc.queryForObject("SELECT snapshot_cipher FROM hr_autopilot_context",String.class);
        assertThat(raw).doesNotContain("你好","测试HR");
    }
    @Test void temporaryFactsRequireAnExplicitSecondConfirmationToPersist() {
        policies.context(conversation,capture("你好",false,true));policies.supplement(1L,conversation,"本次周三有空");
        assertThat(policies.policy(1L).facts()).isEmpty();
        policies.remember(1L,"我有三年运营经验",false);
        assertThat(policies.policy(1L).facts()).isEmpty();
        assertThatThrownBy(()->policies.remember(1L,"其他事实",true)).isInstanceOf(IllegalArgumentException.class);
        policies.remember(1L,"我有三年运营经验",true);
        assertThat(policies.policy(1L).facts()).contains("三年运营经验");
    }
    @Test void durableQqOutboxDoesNotRetryUnknownWritesAndRequiresReceipt() {
        policies.enqueue(1L,"unique","消息正文");policies.enqueue(1L,"unique","重复正文");
        assertThat(policies.pending(1L)).hasSize(1);
        var id=policies.pending(1L).getFirst().id();assertThat(policies.dispatching(id)).isTrue();
        assertThat(policies.pending(1L)).isEmpty();assertThat(policies.deliveryCounts(1L)).containsEntry("UNKNOWN",1);
        assertThat(policies.dispatching(id)).isFalse();
        policies.receipt(id,true,"message-1");assertThat(policies.deliveryCounts(1L)).containsEntry("CONFIRMED",1);
    }
    @Test void normalizationPreservesConfirmedProfile() {
        assertThat(HrAutopilotService.normalized(communication).availability()).isEqualTo(communication.availability());
    }
    @Test void mixedRequestsAndNegatedSharingNeedHuman() {
        var unresolved=new AiDraft(Classification.DOCUMENT_REQUEST,"发送简历","需补充",List.of("其他资料未知"),List.of(),0.99);
        assertThat(service.assess(1L,conversation,capture("发简历并补充其他资料",false,true),unresolved).action()).isEqualTo("HUMAN");
        for(String text:List.of("不要发简历","不用给电话"))
            assertThat(service.assess(1L,conversation,capture(text,false,true),draft(Classification.REPLY,"好的")).action()).isEqualTo("HUMAN");
        verifyNoInteractions(ai);
    }
    @Test void singleCharacterEvidenceCannotAuthorizeAnInventedFact() {
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\": true, \"evidence\": [\"有\"], \"reason\": \"事实有依据\", \"claims\": [{\"text\": \"有\", \"quote\": \"有\", \"entailed\": true}]}");
        assertThat(service.assess(1L,conversation,capture("工作经历",false,true),draft(Classification.REPLY,"有十年经理经验")).action()).isEqualTo("HUMAN");
    }
    @Test void salaryNegotiationAndReversedContactRequestCannotAutoSend() {
        for(String text:List.of("薪资还能再谈吗","能降到12K吗"))
            assertThat(service.assess(1L,conversation,capture(text,false,true),draft(Classification.COMPENSATION,"可以")).action()).isEqualTo("HUMAN");
        assertThat(service.assess(1L,conversation,capture("我给你我的电话",false,true),draft(Classification.CONTACT_REQUEST,"好的")).action()).isEqualTo("HUMAN");
    }
    @Test void realQuoteCannotAuthorizeAnUnrelatedPersonalClaim() {
        assertThat(service.assess(1L,conversation,capture("经验？",false,true),draft(Classification.REPLY,"我有十年经理经验。")).action()).isEqualTo("HUMAN");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\": true, \"evidence\": [\"主动询问岗位职责\"], \"reason\": \"规则\", \"claims\": [{\"text\": \"主动询问岗位职责\", \"quote\": \"主动询问岗位职责\", \"entailed\": true}]}");
        assertThat(service.assess(1L,conversation,capture("经验？",false,true),draft(Classification.REPLY,"我有三年运营经验。")).action()).isEqualTo("HUMAN");
    }
    @Test void confirmedSalaryAvailabilityAndResumeCanPassWhileNoReplyClosesQuietly() {
        when(drafts.trustedFacts(eq(1L),any())).thenReturn("期望15–20K，结合职责面议。确认Offer后两周内。电话13800138000。");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\": true, \"evidence\": [\"期望15–20K，结合职责面议\"], \"reason\": \"固定口径\", \"claims\": [{\"text\": \"期望15–20K\", \"quote\": \"期望15–20K，结合职责面议\", \"entailed\": true}, {\"text\": \"结合职责面议\", \"quote\": \"期望15–20K，结合职责面议\", \"entailed\": true}]}");
        assertThat(service.assess(1L,conversation,capture("期望薪资多少？",false,true),draft(Classification.COMPENSATION,"期望15–20K，结合职责面议。")).action()).isEqualTo("TEXT");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\": true, \"evidence\": [\"确认Offer后两周内\"], \"reason\": \"固定到岗时间\", \"claims\": [{\"text\": \"确认Offer后两周内\", \"quote\": \"确认Offer后两周内\", \"entailed\": true}]}");
        assertThat(service.assess(1L,conversation,capture("什么时候到岗？",false,true),draft(Classification.AVAILABILITY,"确认Offer后两周内。")).action()).isEqualTo("TEXT");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\": true, \"evidence\": [\"测试简历.pdf\"], \"reason\": \"指定附件\", \"claims\": [{\"text\": \"测试简历.pdf\", \"quote\": \"测试简历.pdf\", \"entailed\": true}]}");
        assertThat(service.assess(1L,conversation,capture("请发简历",false,true),draft(Classification.DOCUMENT_REQUEST,"好的")).action()).isEqualTo("RESUME");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\": true, \"evidence\": [], \"reason\": \"纯确认收件\", \"claims\": []}");
        var capture=capture("已收到，评估后联系您",false,true);var reply=draft(Classification.NO_REPLY,"");long id=proposal(capture,reply);
        assertThat(service.apply(1L,id,conversation,capture,reply,"watch")).isFalse();
        assertThat(hr.getProposalView(1L,id).status()).isEqualTo("SKIPPED");
        assertThat(policies.pending(1L)).isEmpty();
    }
    @Test void draftGenerationExplainsNativeBossResumeAndHumanConfirmation() {
        var c=capture("请发简历",false,true);
        service.generate(1L,conversation,communication,c);
        verify(drafts).generateWithFacts(eq(1L),eq(conversation),any(),eq(c.messages()),argThat(text -> text.contains("BOSS聊天框") && text.contains("本人确认") && text.contains("不要求本地文件")));
    }

    private String audit(String text,String quote) {
        try { return new ObjectMapper().writeValueAsString(Map.of("allowed",true,"reason","逐项核验", "evidence", quote.isEmpty()?List.of():List.of(quote), "claims", text.isEmpty()?List.of():List.of(Map.of("text",text,"quote",quote,"entailed",true)))); }
        catch(Exception e) { throw new RuntimeException(e); }
    }
    private void configure(String mode,boolean phone,boolean resume,String history) {
        policies.configure(1L,policies.policy(1L).version(),true,"测试简历.pdf","a".repeat(64),mode,phone,resume,history,30);
    }
    @Test void naturalParaphraseRequiresEveryClaimAndKeepsCriticalValues() {
        when(drafts.trustedFacts(eq(1L),any())).thenReturn("三年运营经验，负责客户维护");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn(audit("我做过三年运营工作","三年运营经验"));
        assertThat(service.assess(1L,conversation,capture("经历？",false,true),draft(Classification.REPLY,"我做过三年运营工作。")).action()).isEqualTo("TEXT");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn(audit("我做过十年运营工作","三年运营经验"));
        assertThat(service.assess(1L,conversation,capture("经历？",false,true),draft(Classification.REPLY,"我做过十年运营工作。")).action()).isEqualTo("HUMAN");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn(audit("我的薪资期望15万","期望15千"));
        when(drafts.trustedFacts(eq(1L),any())).thenReturn("期望15千");
        assertThat(service.assess(1L,conversation,capture("期望？",false,true),draft(Classification.REPLY,"我的薪资期望15万。")).action()).isEqualTo("HUMAN");
    }
    @Test void negatedEvidenceCannotBecomePositiveExperience() {
        when(drafts.trustedFacts(eq(1L),any())).thenReturn("没有Java开发经验");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn(audit("我有Java开发经验","没有Java开发经验"));
        assertThat(service.assess(1L,conversation,capture("会Java吗",false,true),draft(Classification.REPLY,"我有Java开发经验。")).action()).isEqualTo("HUMAN");
    }
    @Test void courtesyAndJobQuestionNeedNoInventedEvidence() {
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn(audit("",""));
        assertThat(service.assess(1L,conversation,capture("您好",false,true),draft(Classification.REPLY,"您好！请问岗位职责？")).action()).isEqualTo("TEXT");
        assertThat(service.assess(1L,conversation,capture("有意向面试吗",false,true),draft(Classification.INTERVIEW_INVITE,"愿意进一步沟通。")).action()).isEqualTo("TEXT");
        assertThat(service.assess(1L,conversation,capture("明天下午面试可以吗",false,true),draft(Classification.INTERVIEW_INVITE,"好的")).action()).isEqualTo("HUMAN");
        assertThat(service.assess(1L,conversation,capture("经历和能力",false,true),draft(Classification.REPLY,"您好，我会Java。")).action()).isEqualTo("HUMAN");
    }
    @Test void textDutyDoesNotRequireAnAttachmentAndReviewModeNeverQueues() {
        policies.configure(1L,policies.policy(1L).version(),true,"","","AUTO",false,false,"RECENT",30);
        assertThat(policies.authorizationValid(1L)).isTrue();
        assertThat(service.assess(1L,conversation,capture("请留个电话",false,true),draft(Classification.CONTACT_REQUEST,"号码")).action()).isEqualTo("HUMAN");
        assertThat(service.assess(1L,conversation,capture("请发简历",false,true),draft(Classification.DOCUMENT_REQUEST,"")).action()).isEqualTo("HUMAN");
        configure("REVIEW",false,false,"RECENT");
        var c=capture("经验？",false,true);var d=draft(Classification.REPLY,"三年运营经验");long id=proposal(c,d);
        assertThat(service.apply(1L,id,conversation,c,d,"watch")).isTrue();
        assertThat(hr.getProposalView(1L,id).status()).isEqualTo("REVIEW_REQUIRED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();
    }
    @Test void legacyAuthorizationAndResumeChangesCannotAuthorizeAutomaticSending() {
        jdbc.update("UPDATE hr_autopilot_policy SET contract_version=0");
        assertThat(policies.authorizationValid(1L)).isFalse();
        configure("AUTO",false,false,"RECENT");
        assertThat(policies.authorizationValid(1L)).isTrue();
        jdbc.update("INSERT INTO resume_profile(profile_id,resume_text) VALUES (1,'新简历')");
        assertThat(policies.authorizationValid(1L)).isFalse();
    }
    @Test void backlogWithinThirtyDaysIsAssessedAndOldOrUnknownDatesAreNotSent() {
        configure("AUTO",false,false,"RECENT");
        var base=capture("工作经验？",true,true);
        var today=java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"));
        for(int age:List.of(0,30,31)) {
            var c=new ChatCapture("age"+age,0,new ChatSession("uid","","HR","公司","岗位","","工作经验？",today.minusDays(age).toString()),base.messages(),true,true);
            assertThat(service.assess(1L,conversation,c,draft(Classification.REPLY,"三年运营经验")).action()).isEqualTo(age<=30?"TEXT":"HISTORY_OLD");
        }
        var unknown=new ChatCapture("unknown",0,new ChatSession("uid","","HR","公司","岗位","","工作经验？","很久以前"),base.messages(),true,true);
        assertThat(service.assess(1L,conversation,unknown,draft(Classification.REPLY,"三年运营经验")).action()).isEqualTo("HUMAN");
    }
    @Test void onlyHistorySkippedSourcesCanBeReconsidered() {
        var c=capture("您好",true,true);long id=proposal(c,draft(Classification.NO_REPLY,""));
        policies.decision(id,2,"HISTORY","历史仅整理",false);hr.markFinal(id,ProposalStatus.SKIPPED,"历史");
        String fingerprint=hr.sourceFingerprint(conversation,c.messages().getLast());
        assertThat(hr.hasHandledSource(conversation,fingerprint,true)).isFalse();
        assertThat(hr.hasHandledSource(conversation,fingerprint,false)).isTrue();
        policies.decision(id,2,"TEXT","人工跳过",false);
        assertThat(hr.hasHandledSource(conversation,fingerprint,true)).isTrue();
        hr.markFinal(id,ProposalStatus.SEND_UNKNOWN,"未知");
        assertThat(hr.hasHandledSource(conversation,fingerprint,true)).isTrue();
    }
    @Test void progressAndEvidenceArePersistedWithoutPlaintext() {
        var c=capture("经验？",false,true);var d=draft(Classification.REPLY,"三年运营经验");long id=proposal(c,d);
        service.apply(1L,id,conversation,c,d,"watch");policies.progress(1L,false);policies.progress(1L,true);
        assertThat(jdbc.queryForObject("SELECT evidence_cipher FROM hr_autopilot_decision WHERE proposal_id=?",String.class,id)).doesNotContain("三年");
        assertThat(jdbc.queryForObject("SELECT processed FROM hr_duty_progress WHERE profile_id=1",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT baseline_complete FROM hr_duty_progress WHERE profile_id=1",Integer.class)).isEqualTo(1);
    }

    @Test void restartRebindsOnlyUnleasedCommandsAndReevaluatesExpiredUnsentSources() {
        var c=capture("经验？",false,true);var d=draft(Classification.REPLY,"三年运营经验");long id=proposal(c,d);
        service.apply(1L,id,conversation,c,d,"old-watch");hr.resumePendingCommands(1L,"new-watch");
        assertThat(jdbc.queryForObject("SELECT watch_session_id FROM hr_send_command WHERE proposal_id=?",String.class,id)).isEqualTo("new-watch");
        jdbc.update("UPDATE hr_send_command SET expires_at=datetime('now','-1 hour') WHERE proposal_id=?",id);
        hr.resumePendingCommands(1L,"restart");
        assertThat(hr.hasHandledSource(conversation,hr.sourceFingerprint(conversation,c.messages().getLast()),true)).isFalse();
        assertThat(hr.getProposalView(1L,id).status()).isEqualTo("EXPIRED");
        jdbc.update("UPDATE hr_send_command SET status='COMPLETE',outcome='RESULT_UNKNOWN' WHERE proposal_id=?",id);
        hr.markFinal(id,ProposalStatus.SEND_UNKNOWN,"未知");hr.resumePendingCommands(1L,"again");
        assertThat(hr.hasHandledSource(conversation,hr.sourceFingerprint(conversation,c.messages().getLast()),true)).isTrue();
    }
    @Test void nativeResumeReviewDoesNotRequireLocalFileAndNeverQueuesAutomatically() {
        policies.configure(1L,policies.policy(1L).version(),true,HrAutopilotStore.BOSS_RESUME,"","REVIEW",false,true,"RECENT",30);
        var c=capture("请发一份简历",false,true);var d=draft(Classification.DOCUMENT_REQUEST,"");
        long id=proposal(c,d);
        assertThat(service.apply(1L,id,conversation,c,d,"watch")).isTrue();
        assertThat(policies.decision(id).action()).isEqualTo("RESUME_NATIVE");
        assertThat(hr.getProposalView(1L,id).draft()).contains("发简历");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();
    }
    @Test void reviewTrialPreservesSuggestionAndSourceWithoutSendCommand() {
        var c=capture("方便聊聊岗位吗",true,true);var d=draft(Classification.REPLY,"您好，方便的。");long id=proposal(c,d);
        service.reviewTrial(1L,id,c,d);
        assertThat(hr.getProposalView(1L,id).draft()).isEqualTo("您好，方便的。");
        assertThat(policies.decision(id).automatic()).isFalse();
        assertThat(jdbc.queryForObject("SELECT capture_origin FROM hr_autopilot_decision WHERE proposal_id=?",String.class,id)).isEqualTo("TRIAL");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();
        verifyNoInteractions(ai);
    }

    @Test void clockTimesAreAlwaysHumanDecisionsIncludingFullWidthColon() {
        for(String question:List.of("明天14:30面试","9：00可以吗")) {
            assertThat(service.assess(1L,conversation,capture(question,false,true),draft(Classification.REPLY,"好的，谢谢")).action()).isEqualTo("HUMAN");
        }
        verifyNoInteractions(ai);
    }
    @Test void conflictingImmediateAndPostOfferAvailabilityCannotBecomeAnAutomaticFact() {
        var conflicting=new CommunicationProfile("15-20K","深圳","确认 Offer 后两周内、可以随时到岗","电话","13800138000","礼貌","不编造");
        hr.saveSettings(1L,conflicting,true,"ws://127.0.0.1:3001","test-token",QqTargetType.GROUP,"987654321","123456",30);
        assertThat(service.assess(1L,conversation,capture("什么时候能到岗",false,true),draft(Classification.AVAILABILITY,"可以随时到岗")).action()).isEqualTo("HUMAN");
        verifyNoInteractions(ai);
    }
    @Test void nativeResumePermissionAllowsOrdinaryAutoDutyButEveryResumeRequestStillNeedsConfirmation() {
        policies.configure(1L,policies.policy(1L).version(),true,HrAutopilotStore.BOSS_RESUME,"","AUTO",false,true,"RECENT",30);
        assertThat(policies.authorizationValid(1L)).isTrue();
        var c=capture("请发一份简历",false,true);long id=proposal(c,draft(Classification.DOCUMENT_REQUEST,""));
        assertThat(service.apply(1L,id,conversation,c,draft(Classification.DOCUMENT_REQUEST,""),"watch")).isTrue();
        assertThat(policies.decision(id).action()).isEqualTo("RESUME_NATIVE");assertThat(policies.decision(id).automatic()).isFalse();
        assertThat(hr.getProposalView(1L,id).draft()).contains("发简历");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();
    }
    @Test void recentScopeStillRejectsThirtyOneDaySourceWhenClientCallsItNew() {
        configure("AUTO",false,false,"RECENT");
        var base=capture("工作经验？",false,true);
        var old=new ChatCapture("claimed-new",1,new ChatSession("uid","","HR","公司","采购","","工作经验？",
                java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")).minusDays(31).toString()),base.messages(),false,true);
        assertThat(service.assess(1L,conversation,old,draft(Classification.REPLY,"三年运营经验")).action()).isEqualTo("HISTORY_OLD");
        verifyNoInteractions(ai);
    }

}
