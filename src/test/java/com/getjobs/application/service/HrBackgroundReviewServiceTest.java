package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import java.util.List;
import static org.assertj.core.api.Assertions.*;

class HrBackgroundReviewServiceTest {
    @TempDir Path dir;
    JdbcTemplate db; HrAssistantStore store; HrBackgroundStore background; HrAutopilotStore policies;
    HrBackgroundReviewService review; int version; ChatCapture source; String id;

    @BeforeEach void setup() {
        var ds=new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("review.db"));
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();db=new JdbcTemplate(ds);
        db.update("INSERT INTO profile(id,name,is_active) VALUES (1,'本人',1),(2,'其他',0)");
        var json=new ObjectMapper();var crypto=new HrAssistantCryptoService(dir.resolve("test.key"));
        store=new HrAssistantStore(db,crypto,json);policies=new HrAutopilotStore(db,json,crypto,store);
        store.saveSettings(1L,CommunicationProfile.empty(),true,"ws://127.0.0.1:3001","test",QqTargetType.GROUP,"123456","234567",30);
        version=policies.configure(1L,1,true,"","","AUTO",false,false,"NEW_ONLY",15).version();
        background=new HrBackgroundStore(db,crypto,json,store,policies);review=new HrBackgroundReviewService(background,store,policies);
        source=new ChatCapture("source",1,new ChatSession("real-uid","","联系人","公司","","","现在在职吗？","10:55"),
                List.of(new ChatMessage("本人","文本","您好","昨天","self",List.of()),
                        new ChatMessage("对方","文本","现在在职吗？","10:55","incoming",List.of())),true,true);
        id=save(source);
    }
    String save(ChatCapture capture) {
        background.accept(1L,"account",version,capture);
        return db.queryForObject("SELECT id FROM hr_background_capture ORDER BY rowid DESC LIMIT 1",String.class);
    }
    HrBackgroundReviewService.ReviewRequest request() {return new HrBackgroundReviewService.ReviewRequest(1L,version,"您好，我目前仍在职。");}
    long historySkip() {
        long conversation=background.resolveConversation(1L,source);String fingerprint=background.sourceFingerprint(1L,conversation,source,source.messages().getLast());
        store.updateLastInbound(conversation,fingerprint);
        long proposal=store.createProposal(1L,conversation,fingerprint,new AiDraft(Classification.NO_REPLY,"","启用前历史仅整理",List.of(),List.of(),1));
        policies.decision(proposal,version,"HISTORY","启用前历史仅整理",true);store.markFinal(proposal,ProposalStatus.SKIPPED,"历史");return proposal;
    }
    @Test void selectedHistoryGetsOneManualReviewWithoutChangingPolicyFactsOriginOrSending() {
        long original=historySkip();var policyBefore=db.queryForList("SELECT * FROM hr_autopilot_policy");var captureBefore=db.queryForList("SELECT * FROM hr_background_capture");
        var proposal=review.prepare(1L,"account",id,request());
        assertThat(proposal.status()).isEqualTo("REVIEW_REQUIRED");assertThat(proposal.draft()).isEqualTo(request().draft());assertThat(proposal.jobName()).isEmpty();
        assertThat(store.getProposalView(1L,original).status()).isEqualTo("SKIPPED");
        assertThat(db.queryForList("SELECT * FROM hr_autopilot_policy")).isEqualTo(policyBefore);
        assertThat(db.queryForList("SELECT * FROM hr_background_capture")).isEqualTo(captureBefore);
        assertThat(db.queryForObject("SELECT automatic FROM hr_autopilot_decision WHERE proposal_id=?",Integer.class,proposal.id())).isZero();
        assertThat(db.queryForObject("SELECT capture_origin FROM hr_autopilot_decision WHERE proposal_id=?",String.class,proposal.id())).isEqualTo("BACKLOG");
        assertThat(policies.context(1L,proposal.conversationId())).isEqualTo(source);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();
        assertThatThrownBy(()->review.prepare(1L,"account",id,request())).isInstanceOf(HrAssistantStore.StaleProposalException.class);
    }
    @Test void currentAccountProfileAuthorizationAndAvailableEvidenceAreRequired() {
        assertThatThrownBy(()->review.prepare(2L,"account",id,request())).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        assertThatThrownBy(()->review.prepare(1L,"other-account",id,request())).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        assertThatThrownBy(()->review.prepare(1L,"account",id,new HrBackgroundReviewService.ReviewRequest(1L,version-1,"回复"))).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        policies.pause(1L,true);assertThatThrownBy(()->review.prepare(1L,"account",id,request())).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        policies.pause(1L,false);db.update("UPDATE hr_background_capture SET payload_cipher='' WHERE id=?",id);
        assertThatThrownBy(()->review.prepare(1L,"account",id,request())).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_reply_proposal",Integer.class)).isZero();
    }
    @Test void authorizationIsCheckedEvenForNullWrongProfileOrWrongVersionRequests() {
        var checked=org.mockito.Mockito.spy(policies);var target=new HrBackgroundReviewService(background,store,checked);
        for(var request:new HrBackgroundReviewService.ReviewRequest[]{null,
                new HrBackgroundReviewService.ReviewRequest(2L,version,"回复"),
                new HrBackgroundReviewService.ReviewRequest(1L,version-1,"回复")}) {
            org.mockito.Mockito.clearInvocations(checked);
            assertThatThrownBy(()->target.prepare(1L,"account",id,request)).isInstanceOf(HrAssistantStore.StaleProposalException.class);
            org.mockito.Mockito.verify(checked).authorizationValid(1L);
        }
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_reply_proposal",Integer.class)).isZero();
    }
    @Test void partialUnknownCardsAnsweredOrMismatchingPreviewsCannotBeReviewed() {
        var messages=source.messages();
        var unknown=new java.util.ArrayList<>(messages);unknown.add(new ChatMessage("对方","其他","","","card",List.of(new MediaContent("image","image/png","","","CAPTURED",""))));
        var answered=new java.util.ArrayList<>(messages);answered.add(new ChatMessage("本人","文本","已回复","现在","reply",List.of()));
        var wrong=new ChatSession("other-uid","","联系人","公司","","","不同预览","10:55");
        for(var bad:List.of(new ChatCapture("partial",1,source.session(),messages,true,false),
                new ChatCapture("card",1,source.session(),unknown,true,true),new ChatCapture("answered",1,source.session(),answered,true,true),
                new ChatCapture("wrong",1,wrong,messages,true,true))) {
            String badId=save(bad);assertThatThrownBy(()->review.prepare(1L,"account",badId,request())).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        }
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_reply_proposal",Integer.class)).isZero();
    }
    @Test void newSourceManualSkipExistingReviewAndUnknownCannotBeOverwrittenOrReplayed() {
        long original=historySkip();long conversation=store.requireProposal(1L,original).conversationId();
        policies.decision(original,version,"SKIP","人工跳过",false);
        assertThatThrownBy(()->review.prepare(1L,"account",id,request())).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        store.markFinal(original,ProposalStatus.SEND_UNKNOWN,"未知");
        assertThatThrownBy(()->review.prepare(1L,"account",id,request())).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        store.markFinal(original,ProposalStatus.SKIPPED,"历史");policies.decision(original,version,"HISTORY","历史",true);
        store.updateLastInbound(conversation,"new-source");
        assertThatThrownBy(()->review.prepare(1L,"account",id,request())).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        assertThat(db.queryForObject("SELECT last_inbound_fingerprint FROM hr_conversation WHERE id=?",String.class,conversation)).isEqualTo("new-source");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_reply_proposal",Integer.class)).isEqualTo(1);
    }
    @Test void normalSendStillRequiresRealPageWholeRoundAndConfirmsOnlyItsReceipt() {
        var proposal=review.prepare(1L,"account",id,request());
        var actions=new HrReplyActionService(store,org.mockito.Mockito.mock(HrAssistantEventService.class));
        var auto=org.mockito.Mockito.mock(HrAutopilotService.class);
        org.mockito.Mockito.when(auto.policy(1L)).thenReturn(policies.policy(1L));
        actions.setAutopilot(policies,auto);actions.setBackgroundStore(background);
        store.queueSendCommand(1L,proposal.id(),proposal.version(),"watch");var command=actions.claim(1L,"watch");
        assertThat(command.expectedInboundRound()).containsExactly(source.messages().getLast());
        assertThatThrownBy(()->actions.dispatch(1L,"watch",command.commandId(),command.leaseToken(),
                new ChatCapture("partial",1,source.session(),source.messages(),true,false))).isInstanceOf(IllegalArgumentException.class);
        assertThat(store.getProposalView(1L,proposal.id()).status()).isNotEqualTo("SENT_CONFIRMED");
        actions.dispatch(1L,"watch",command.commandId(),command.leaseToken(),source);
        var after=new java.util.ArrayList<>(source.messages());after.add(new ChatMessage("本人","文本",proposal.draft(),"10:56","sent",List.of()));
        assertThat(actions.complete(1L,"watch",command.commandId(),command.leaseToken(),"SENT","真实页面回执",null,
                new ChatCapture("after",0,source.session(),after,true,true),true).status()).isEqualTo("SENT_CONFIRMED");
    }

    @Test void deliveryDiagnosticsReadOnlyReturnsScopedEvidenceWithoutLeasesOrChangingUnknown() {
        var proposal=review.prepare(1L,"account",id,request());
        store.queueSendCommand(1L,proposal.id(),1,"watch");var command=store.claimSendCommand(1L,"watch");
        store.dispatchSendCommand(1L,"watch",command.commandId(),command.leaseToken(),source);
        store.completeSendCommand(1L,"watch",command.commandId(),command.leaseToken(),"RESULT_UNKNOWN","发送动作已触发但未确认相同本人出站消息",null);
        var commands=db.queryForList("SELECT * FROM hr_send_command");var proposals=db.queryForList("SELECT * FROM hr_reply_proposal");
        var view=store.inspectDelivery(1L,proposal.id());
        assertThat(view).containsEntry("status","SEND_UNKNOWN");assertThat(view.toString()).contains("发送动作已触发但未确认相同本人出站消息").doesNotContain(command.leaseToken(),command.commandId(),"evidence_cipher");
        assertThatThrownBy(()->store.inspectDelivery(2L,proposal.id())).isInstanceOf(IllegalArgumentException.class);
        assertThat(db.queryForList("SELECT * FROM hr_send_command")).isEqualTo(commands);assertThat(db.queryForList("SELECT * FROM hr_reply_proposal")).isEqualTo(proposals);
    }
}
