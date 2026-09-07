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
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\":true,\"evidence\":[\"三年运营经验\"],\"reason\":\"事实有依据\"}");
        conversation=hr.upsertConversation(1L,new ChatSession("uid","","测试HR","测试公司","运营","测试HR","",""));
        policies.configure(1L,1,true,"测试简历.pdf","a".repeat(64));
    }
    ChatCapture capture(String question, boolean historical, boolean complete) {
        return new ChatCapture("capture",1,new ChatSession("uid","","测试HR","测试公司","运营","测试HR",question,""),
                List.of(new ChatMessage("本人","文本","您好","昨天","m1",List.of()),new ChatMessage("对方","文本",question,"今天","m2",List.of())),historical,complete);
    }
    AiDraft draft(Classification c,String text) {return new AiDraft(c,text,"摘要",List.of(),List.of(),0.99);}
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
        var result=service.assess(1L,conversation,capture("请留个电话",false,true),draft(Classification.CONTACT_REQUEST,"其他号码"));
        assertThat(result.action()).isEqualTo("PHONE");assertThat(result.draft()).contains("13800138000").doesNotContain("其他号码");
    }
    @Test void unsupportedEvidenceAndProviderFailureBothNeedHuman() {
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\":true,\"evidence\":[\"编造经历\"],\"reason\":\"好\"}");
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
    @Test void normalizationRemovesContradictoryAvailability() {
        assertThat(HrAutopilotService.normalized(communication).availability()).isEqualTo("确认Offer后两周内");
    }
    @Test void mixedRequestsAndNegatedSharingNeedHuman() {
        var unresolved=new AiDraft(Classification.DOCUMENT_REQUEST,"发送简历","需补充",List.of("其他资料未知"),List.of(),0.99);
        assertThat(service.assess(1L,conversation,capture("发简历并补充其他资料",false,true),unresolved).action()).isEqualTo("HUMAN");
        for(String text:List.of("不要发简历","不用给电话"))
            assertThat(service.assess(1L,conversation,capture(text,false,true),draft(Classification.REPLY,"好的")).action()).isEqualTo("HUMAN");
        verifyNoInteractions(ai);
    }
    @Test void singleCharacterEvidenceCannotAuthorizeAnInventedFact() {
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\":true,\"evidence\":[\"有\"],\"reason\":\"事实有依据\"}");
        assertThat(service.assess(1L,conversation,capture("工作经历",false,true),draft(Classification.REPLY,"有十年经理经验")).action()).isEqualTo("HUMAN");
    }
    @Test void salaryNegotiationAndReversedContactRequestCannotAutoSend() {
        for(String text:List.of("薪资还能再谈吗","能降到12K吗"))
            assertThat(service.assess(1L,conversation,capture(text,false,true),draft(Classification.COMPENSATION,"可以")).action()).isEqualTo("HUMAN");
        assertThat(service.assess(1L,conversation,capture("我给你我的电话",false,true),draft(Classification.CONTACT_REQUEST,"好的")).action()).isEqualTo("HUMAN");
    }
    @Test void realQuoteCannotAuthorizeAnUnrelatedPersonalClaim() {
        assertThat(service.assess(1L,conversation,capture("经验？",false,true),draft(Classification.REPLY,"我有十年经理经验。")).action()).isEqualTo("HUMAN");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\":true,\"evidence\":[\"主动询问岗位职责\"],\"reason\":\"规则\"}");
        assertThat(service.assess(1L,conversation,capture("经验？",false,true),draft(Classification.REPLY,"我有三年运营经验。")).action()).isEqualTo("HUMAN");
    }
    @Test void confirmedSalaryAvailabilityAndResumeCanPassWhileNoReplyClosesQuietly() {
        when(drafts.trustedFacts(eq(1L),any())).thenReturn("期望15–20K，结合职责面议。确认Offer后两周内。电话13800138000。");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\":true,\"evidence\":[\"期望15–20K，结合职责面议\"],\"reason\":\"固定口径\"}");
        assertThat(service.assess(1L,conversation,capture("期望薪资多少？",false,true),draft(Classification.COMPENSATION,"期望15–20K，结合职责面议。")).action()).isEqualTo("TEXT");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\":true,\"evidence\":[\"确认Offer后两周内\"],\"reason\":\"固定到岗时间\"}");
        assertThat(service.assess(1L,conversation,capture("什么时候到岗？",false,true),draft(Classification.AVAILABILITY,"确认Offer后两周内。")).action()).isEqualTo("TEXT");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\":true,\"evidence\":[\"测试简历.pdf\"],\"reason\":\"指定附件\"}");
        assertThat(service.assess(1L,conversation,capture("请发简历",false,true),draft(Classification.DOCUMENT_REQUEST,"好的")).action()).isEqualTo("RESUME");
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\":true,\"evidence\":[],\"reason\":\"纯确认收件\"}");
        var capture=capture("已收到，评估后联系您",false,true);var reply=draft(Classification.NO_REPLY,"");long id=proposal(capture,reply);
        assertThat(service.apply(1L,id,conversation,capture,reply,"watch")).isFalse();
        assertThat(hr.getProposalView(1L,id).status()).isEqualTo("SKIPPED");
        assertThat(policies.pending(1L)).isEmpty();
    }
    @Test void draftGenerationIncludesTheExplicitlyApprovedResumeVersion() {
        var c=capture("请发简历",false,true);
        service.generate(1L,conversation,communication,c);
        verify(drafts).generateWithFacts(eq(1L),eq(conversation),any(),eq(c.messages()),contains("测试简历.pdf"));
    }
}
