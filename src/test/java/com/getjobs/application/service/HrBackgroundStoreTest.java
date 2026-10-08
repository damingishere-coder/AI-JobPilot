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

class HrBackgroundStoreTest {
    @TempDir Path dir;
    JdbcTemplate db;
    HrAssistantStore hr;
    HrAutopilotStore policies;
    HrBackgroundStore background;

    @BeforeEach void setup() {
        var ds=new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("background.db"));
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        db=new JdbcTemplate(ds);
        db.update("INSERT INTO profile(id,name,is_active) VALUES (1,'测试',1),(2,'其他',0)");
        var json=new ObjectMapper();var crypto=new HrAssistantCryptoService(dir.resolve("test.key"));
        hr=new HrAssistantStore(db,crypto,json);policies=new HrAutopilotStore(db,json,crypto,hr);
        background=new HrBackgroundStore(db,crypto,json,hr,policies);
    }
    ChatCapture capture(String uid,String id,String job,String text) {
        return new ChatCapture(id,1,new ChatSession(uid,"","测试HR","测试公司",job,"",text,"今天"),
                List.of(new ChatMessage("本人","文本","您好","昨天"),new ChatMessage("对方","文本",text,"今天")),false,true);
    }
    long unknownVisual(String uid) {
        return unknownVisual(uid,"采购");
    }
    long unknownVisual(String uid,String job) {
        var observed=capture(uid,"old", job, "请介绍经验");
        long conversation=hr.upsertVisualConversation(1L,observed.session());
        for(var message:observed.messages())hr.saveMessage(conversation,message,30);
        String source=hr.sourceFingerprint(conversation,observed.messages().getLast());hr.updateLastInbound(conversation,source);
        long proposal=hr.createProposal(1L,conversation,source,new AiDraft(Classification.REPLY,"三年经验","普通提问",List.of(),List.of(),1));
        policies.context(conversation,observed);hr.markFinal(proposal,ProposalStatus.SEND_UNKNOWN,"结果未核验");
        return conversation;
    }
    @Test void ackStoresEncryptedSourceAndDedupeDoesNotOverwriteChangedContent() {
        var capture=capture("chrome-uid","capture","采购","请介绍经验");
        assertThat(background.accept(1L,"测试",2,capture).duplicate()).isFalse();
        assertThat(background.accept(1L,"测试",2,capture).duplicate()).isTrue();
        assertThat(db.queryForObject("SELECT payload_cipher FROM hr_background_capture",String.class)).doesNotContain("请介绍经验","测试HR","chrome-uid");
        assertThatThrownBy(()->background.accept(1L,"测试",2,capture("chrome-uid","capture","采购","新的正文"))).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        assertThat(background.claim(2L,"测试",2)).isNull();
        assertThat(background.claim(1L,"其他账号",2)).isNull();
        var task=background.claim(1L,"测试",2);assertThat(task.capture()).isEqualTo(capture);
        assertThat(background.claim(1L,"测试",2)).isNull();
    }
    @Test void restartRecoversOnlyAnalysisAndRejectsOldPolicyWhileKeepingSource() {
        background.accept(1L,"测试",2,capture("uid","c","采购","问题"));
        var task=background.claim(1L,"测试",2);assertThat(task).isNotNull();
        background.recover();assertThat(background.claim(1L,"测试",2)).isNotNull();
        background.recover();assertThat(background.claim(1L,"测试",3)).isNull();
        assertThat(db.queryForObject("SELECT status||':'||error_code FROM hr_background_capture",String.class)).isEqualTo("BLOCKED:AUTHORIZATION_CHANGED");
        assertThat(db.queryForObject("SELECT length(payload_cipher) FROM hr_background_capture",Integer.class)).isGreaterThan(30);
    }
    @Test void sameSourceIgnoresUnreadHistoricalFlagsAndOlderContextWhileIncompleteCanBeUpgraded() {
        var full=capture("uid","same","采购","请介绍经验");
        var incomplete=new ChatCapture(full.captureId(),0,full.session(),full.messages(),true,false);
        background.accept(1L,"测试",2,incomplete);
        var expanded=new java.util.ArrayList<ChatMessage>();expanded.add(new ChatMessage("本人","文本","较早的上下文","上周"));expanded.addAll(full.messages());
        var reread=new ChatCapture(full.captureId(),4,full.session(),expanded,false,true);
        assertThat(background.accept(1L,"测试",2,reread).duplicate()).isTrue();
        var task=background.claim(1L,"测试",2);assertThat(task.capture().contextComplete()).isTrue();assertThat(task.capture().messages()).hasSize(3);
        assertThat(task.capture().historical()).isTrue();
        background.finish(task.id(),"");
        assertThat(background.accept(1L,"测试",2,full).queueStatus()).isEqualTo("DONE");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_background_capture",Integer.class)).isEqualTo(1);
    }
    @Test void freshSameSourceRestoresOnlyUnfinishedWorkUnderCurrentAuthorization() {
        var capture=capture("uid","reauth","采购","问题");background.accept(1L,"测试",2,capture);
        assertThat(background.claim(1L,"测试",3)).isNull();
        assertThat(background.accept(1L,"测试",3,capture).queueStatus()).isEqualTo("PENDING");
        var task=background.claim(1L,"测试",3);assertThat(task.policyVersion()).isEqualTo(3);
        background.finish(task.id(),"");assertThat(background.claim(1L,"测试",3)).isNull();
        assertThat(background.accept(1L,"测试",4,capture).queueStatus()).isEqualTo("DONE");
        var other=capture("other","held","采购","人工问题");background.accept(1L,"测试",2,other);
        task=background.claim(1L,"测试",2);background.finish(task.id(),"IDENTITY_NOT_VERIFIED");
        assertThat(background.accept(1L,"测试",3,other).queueStatus()).isEqualTo("BLOCKED");
    }
    @Test void freshAuthorizationReassessesOnlyUnchangedNeverSentSuggestionsOnce() {
        var capture=capture("uid","review","采购","问题");long conversation=hr.upsertConversation(1L,capture.session());
        for(var m:capture.messages())hr.saveMessage(conversation,m,30);
        String source=hr.sourceFingerprint(conversation,capture.messages().getLast());hr.updateLastInbound(conversation,source);
        background.accept(1L,"测试",2,capture);var task=background.claim(1L,"测试",2);
        long old=hr.createProposal(1L,conversation,source,new AiDraft(Classification.REPLY,"旧建议","回复",List.of(),List.of(),1));
        policies.decision(old,2,"TEXT","待本人确认",false);background.finish(task.id(),"");
        assertThat(background.accept(1L,"测试",3,capture).queueStatus()).isEqualTo("PENDING");
        task=background.claim(1L,"测试",3);
        assertThat(hr.prepareCompleteBackgroundSource(1L,conversation,source,true,3)).isFalse();
        assertThat(hr.getProposalView(1L,old).status()).isEqualTo("EXPIRED");
        long fresh=hr.createProposal(1L,conversation,source,new AiDraft(Classification.REPLY,"新建议","回复",List.of(),List.of(),1));
        policies.decision(fresh,3,"TEXT","重新审核",false);background.finish(task.id(),"");
        assertThat(background.accept(1L,"测试",3,capture).queueStatus()).isEqualTo("DONE");
        assertThat(hr.prepareCompleteBackgroundSource(1L,conversation,source,true,3)).isTrue();
        hr.revise(1L,fresh,1,"本人改稿");
        assertThat(background.accept(1L,"测试",4,capture).queueStatus()).isEqualTo("DONE");
        assertThat(hr.prepareCompleteBackgroundSource(1L,conversation,source,true,4)).isTrue();
        hr.markFinal(fresh,ProposalStatus.SEND_UNKNOWN,"未知结果");
        assertThat(background.accept(1L,"测试",5,capture).queueStatus()).isEqualTo("DONE");
    }
    @Test void freshCaptureCanReassessExpiredUnleasedAutomaticCommandsWithoutReplayingManualDrafts() {
        var capture=capture("uid","expired","采购","问题");long conversation=hr.upsertConversation(1L,capture.session());
        for(var m:capture.messages())hr.saveMessage(conversation,m,30);
        String source=hr.sourceFingerprint(conversation,capture.messages().getLast());hr.updateLastInbound(conversation,source);
        background.accept(1L,"测试",2,capture);var task=background.claim(1L,"测试",2);
        long proposal=hr.createProposal(1L,conversation,source,new AiDraft(Classification.REPLY,"好的","回复",List.of(),List.of(),1));
        policies.decision(proposal,2,"TEXT","独立审核",true);hr.queueSendCommand(1L,proposal,1,"old");background.finish(task.id(),"");
        db.update("UPDATE hr_send_command SET expires_at=datetime('now','-1 day')");hr.resumePendingCommands(1L,"new");
        assertThat(hr.getProposalView(1L,proposal).version()).isEqualTo(3);
        assertThat(background.accept(1L,"测试",2,capture).queueStatus()).isEqualTo("PENDING");
        task=background.claim(1L,"测试",2);assertThat(hr.prepareCompleteBackgroundSource(1L,conversation,source,true,2)).isFalse();
        long manual=hr.createProposal(1L,conversation,source,new AiDraft(Classification.REPLY,"好的","回复",List.of(),List.of(),1));
        policies.decision(manual,2,"TEXT","原有审核",true);hr.revise(1L,manual,1,"人工改稿");
        policies.decision(manual,2,"TEXT","用户修改后的文字回复",false);hr.queueSendCommand(1L,manual,2,"old");
        db.update("UPDATE hr_send_command SET expires_at=datetime('now','-1 day') WHERE proposal_id=?",manual);hr.resumePendingCommands(1L,"new");background.finish(task.id(),"");
        assertThat(background.accept(1L,"测试",3,capture).queueStatus()).isEqualTo("DONE");
        assertThat(hr.prepareCompleteBackgroundSource(1L,conversation,source,true,3)).isTrue();
    }
    @Test void revocationRetiresOnlyUnleasedAutomaticWorkForFreshAuthorizedReassessment() {
        var capture=capture("uid","stop-start","采购","问题");long conversation=hr.upsertConversation(1L,capture.session());
        for(var m:capture.messages())hr.saveMessage(conversation,m,30);
        String source=hr.sourceFingerprint(conversation,capture.messages().getLast());hr.updateLastInbound(conversation,source);
        background.accept(1L,"测试",2,capture);var task=background.claim(1L,"测试",2);
        long proposal=hr.createProposal(1L,conversation,source,new AiDraft(Classification.REPLY,"好的","回复",List.of(),List.of(),1));
        policies.decision(proposal,2,"TEXT","独立审核",true);hr.queueSendCommand(1L,proposal,1,"old");background.finish(task.id(),"");
        policies.disable(1L);
        assertThat(hr.getProposalView(1L,proposal).status()).isEqualTo("EXPIRED");
        assertThat(db.queryForObject("SELECT status||':'||outcome FROM hr_send_command",String.class)).isEqualTo("STALE:EXPIRED_UNSENT");
        assertThat(hr.claimSendCommand(1L,"new")).isNull();
        assertThat(background.accept(1L,"测试",3,capture).queueStatus()).isEqualTo("PENDING");
        assertThat(hr.prepareCompleteBackgroundSource(1L,conversation,source,true,3)).isFalse();
        task=background.claim(1L,"测试",3);background.finish(task.id(),"");
        long fresh=hr.createProposal(1L,conversation,source,new AiDraft(Classification.REPLY,"新审核","回复",List.of(),List.of(),1));policies.decision(fresh,3,"TEXT","新授权",true);
        assertThat(background.accept(1L,"测试",3,capture).queueStatus()).isEqualTo("DONE");
    }
    @Test void completeVisualSourceLinksToOriginalConversationWithoutResettingUnknownOrUid() {
        long old=unknownVisual("visual:old");
        var observed=capture("real-platform-uid","c","采购","请介绍经验");
        assertThat(background.legacyAnchors(1L)).hasSize(1);
        assertThat(background.resolveConversation(1L,observed)).isEqualTo(old);
        assertThat(background.resolveConversation(1L,observed)).isEqualTo(old);
        assertThat(policies.conversationHeld(old)).isTrue();
        assertThat(background.legacyAnchors(1L)).isEmpty();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_conversation",Integer.class)).isEqualTo(1);
        assertThat(hr.recentMessages(old,20)).extracting(ChatMessage::text).contains("请介绍经验");
        assertThat(db.queryForObject("SELECT evidence_cipher FROM hr_chrome_conversation_alias",String.class)).doesNotContain("测试HR","请介绍经验");
        assertThatThrownBy(()->background.resolveConversation(1L,capture("real-platform-uid","new","采购主管","请介绍经验")))
                .isInstanceOf(HrBackgroundStore.IdentityHeldException.class);
    }
    @Test void freshIdentityRetryWaitsForLegacyMappingAndNeverUnfreezesUnknown() {
        long old=unknownVisual("visual:old");
        var session=new ChatSession("new-uid","","其他HR","其他公司","销售","","新的提问","今天");
        var capture=new ChatCapture("held-new",1,session,List.of(new ChatMessage("对方","文本","新的提问","今天")),false,true);
        background.accept(1L,"测试",2,capture);
        var task=background.claim(1L,"测试",2);
        assertThatThrownBy(()->background.resolveConversation(1L,capture)).isInstanceOf(HrBackgroundStore.IdentityHeldException.class);
        background.finish(task.id(),"LEGACY_IDENTITY_UNRESOLVED");
        assertThat(background.accept(1L,"测试",2,capture).queueStatus()).isEqualTo("BLOCKED");
        assertThat(background.claim(1L,"测试",2)).isNull();
        assertThat(background.resolveConversation(1L,capture("old-platform-uid","old-read","采购","请介绍经验"))).isEqualTo(old);
        assertThat(policies.conversationHeld(old)).isTrue();
        assertThat(background.accept(1L,"测试",2,capture).queueStatus()).isEqualTo("PENDING");
        task=background.claim(1L,"测试",2);
        long independent=background.resolveConversation(1L,task.capture());
        assertThat(independent).isNotEqualTo(old);
        background.finish(task.id(),"");
        assertThat(background.accept(1L,"测试",2,capture).queueStatus()).isEqualTo("DONE");
        assertThat(db.queryForObject("SELECT status FROM hr_reply_proposal WHERE conversation_id=?",String.class,old)).isEqualTo("SEND_UNKNOWN");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();
    }
    @Test void identityRetryKeepsHistoricalScopeAndRejectsChangedOrIncompleteEvidence() {
        var source=capture("uid","identity-retry","采购","问题");
        var historical=new ChatCapture(source.captureId(),source.unreadCount(),source.session(),source.messages(),true,true);
        background.accept(1L,"测试",2,historical);var task=background.claim(1L,"测试",2);background.finish(task.id(),"LEGACY_IDENTITY_UNRESOLVED");
        assertThatThrownBy(()->background.accept(1L,"其他账号",2,source)).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        assertThatThrownBy(()->background.accept(1L,"测试",2,capture("other-uid",source.captureId(),"采购","问题"))).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        assertThatThrownBy(()->background.accept(1L,"测试",2,capture("uid",source.captureId(),"销售","问题"))).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        assertThatThrownBy(()->background.accept(1L,"测试",2,capture("uid",source.captureId(),"采购","更改的问题"))).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        var incomplete=new ChatCapture(source.captureId(),source.unreadCount(),source.session(),source.messages(),false,false);
        assertThat(background.accept(1L,"测试",2,incomplete).queueStatus()).isEqualTo("BLOCKED");
        assertThat(background.accept(1L,"测试",2,source).queueStatus()).isEqualTo("PENDING");
        task=background.claim(1L,"测试",2);assertThat(task.capture().historical()).isTrue();
        background.finish(task.id(),"IDENTITY_NOT_VERIFIED");
        assertThat(background.accept(1L,"测试",2,source).queueStatus()).isEqualTo("BLOCKED");
    }
    @Test void nameAloneOrPartialRoundNeverLinksAndExistingUnrelatedPlatformUidCanContinue() {
        unknownVisual("visual:old");
        assertThatThrownBy(()->background.resolveConversation(1L,capture("uid","c","销售","请介绍经验")))
                .isInstanceOf(HrBackgroundStore.IdentityHeldException.class);
        assertThatThrownBy(()->background.resolveConversation(1L,capture("uid","c","采购","新的问题")))
                .isInstanceOf(HrBackgroundStore.IdentityHeldException.class);
        var different=new ChatSession("already-verified","","其他HR","其他公司","销售","","问题","今天");
        long unrelated=hr.upsertConversation(1L,different);
        var observed=new ChatCapture("other",1,different,List.of(new ChatMessage("对方","文本","问题","今天")),false,true);
        assertThat(background.resolveConversation(1L,observed)).isEqualTo(unrelated);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_chrome_conversation_alias",Integer.class)).isZero();
    }
    @Test void duplicatedVisualJobTitleStillRequiresTheUniqueCompleteOriginalRound() {
        long old=unknownVisual("visual:old","AI产品经理AI产品经理（广告方向）");
        assertThatThrownBy(()->background.resolveConversation(1L,capture("real-uid","partial","AI产品经理（广告方向）","新的问题")))
                .isInstanceOf(HrBackgroundStore.IdentityHeldException.class);
        assertThatThrownBy(()->background.resolveConversation(1L,capture("real-uid","different","AI产品经理（其他方向）","请介绍经验")))
                .isInstanceOf(HrBackgroundStore.IdentityHeldException.class);
        assertThat(background.resolveConversation(1L,capture("real-uid","complete","AI产品经理（广告方向）","请介绍经验"))).isEqualTo(old);
        assertThat(policies.conversationHeld(old)).isTrue();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_conversation",Integer.class)).isEqualTo(1);
        assertThat(db.queryForObject("SELECT status FROM hr_reply_proposal WHERE conversation_id=?",String.class,old)).isEqualTo("SEND_UNKNOWN");
    }
    @Test void jobNormalizationDoesNotReplaceMissingOrDifferentContactIdentity() {
        unknownVisual("visual:old","AI产品经理AI产品经理（广告方向）");
        var source=capture("real-uid","complete","AI产品经理（广告方向）","请介绍经验");
        for(var identity:List.of(
                new ChatSession("real-uid","","其他HR","测试公司",source.session().jobName(),"","请介绍经验","今天"),
                new ChatSession("real-uid","","测试HR","其他公司",source.session().jobName(),"","请介绍经验","今天"))) {
            assertThatThrownBy(()->background.resolveConversation(1L,new ChatCapture(source.captureId(),1,identity,source.messages(),false,true)))
                    .isInstanceOf(HrBackgroundStore.IdentityHeldException.class);
        }
        unknownVisual("visual:short","采购采购");
        assertThatThrownBy(()->background.resolveConversation(1L,capture("short-uid","short","采购","请介绍经验")))
                .isInstanceOf(HrBackgroundStore.IdentityHeldException.class);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_chrome_conversation_alias",Integer.class)).isZero();
    }
    @Test void unchangedAmbiguousVisualIdentityDoesNotKeepRetryingAfterGlobalHoldDisappears() {
        long first=unknownVisual("visual:first"),second=unknownVisual("visual:second");
        db.update("UPDATE hr_reply_proposal SET status='SENT_CONFIRMED' WHERE conversation_id IN (?,?)",first,second);
        var source=capture("real-uid","ambiguous","采购","请介绍经验");
        background.accept(1L,"测试",2,source);var task=background.claim(1L,"测试",2);
        background.finish(task.id(),"LEGACY_IDENTITY_UNRESOLVED");
        assertThat(background.accept(1L,"测试",2,source).queueStatus()).isEqualTo("BLOCKED");
        assertThat(background.claim(1L,"测试",2)).isNull();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_chrome_conversation_alias",Integer.class)).isZero();
    }
    @Test void twoIdenticalVisualIdentitiesStayReadOnlyRatherThanGuessing() {
        unknownVisual("visual:first");unknownVisual("visual:second");
        assertThatThrownBy(()->background.resolveConversation(1L,capture("uid","c","采购","请介绍经验")))
                .isInstanceOf(HrBackgroundStore.IdentityHeldException.class);
        assertThat(background.legacyAnchors(1L)).hasSize(2);
    }
    @Test void browserMessageIdsDoNotTurnAlreadyConfirmedVisualSourceIntoNewUnsentSource() {
        long old=unknownVisual("visual:old");
        long proposal=db.queryForObject("SELECT id FROM hr_reply_proposal WHERE conversation_id=?",Long.class,old);
        hr.markFinal(proposal,ProposalStatus.SENT_CONFIRMED,"已有真实发送回执");
        var base=capture("real-uid","new","采购","请介绍经验");
        var realMessages=base.messages().stream().map(m->new ChatMessage(m.from(),m.type(),m.text(),m.time(),"platform-"+m.from(),List.of())).toList();
        var browser=new ChatCapture(base.captureId(),base.unreadCount(),base.session(),realMessages,false,true);
        assertThat(background.resolveConversation(1L,browser)).isEqualTo(old);
        String canonicalSource=background.sourceFingerprint(1L,old,browser,browser.messages().getLast());
        assertThat(hr.hasHandledSource(old,canonicalSource,true)).isTrue();
        assertThat(canonicalSource).isEqualTo(db.queryForObject("SELECT source_fingerprint FROM hr_reply_proposal WHERE id=?",String.class,proposal));
        assertThat(canonicalSource).isNotEqualTo(hr.sourceFingerprint(old,browser.messages().getLast()));
    }
    @Test void matchingOlderVisualRoundDoesNotAliasANewHrRoundToTheOldConfirmedSource() {
        long old=unknownVisual("visual:old");long proposal=db.queryForObject("SELECT id FROM hr_reply_proposal WHERE conversation_id=?",Long.class,old);
        hr.markFinal(proposal,ProposalStatus.SENT_CONFIRMED,"真实旧回执");
        var base=capture("real-uid","new","采购","请介绍经验");
        var messages=new java.util.ArrayList<>(base.messages().stream().map(m->new ChatMessage(m.from(),m.type(),m.text(),m.time(),"platform-"+m.from(),List.of())).toList());
        messages.add(new ChatMessage("本人","文本","旧回复","今天","self-reply",List.of()));
        messages.add(new ChatMessage("对方","文本","新的问题","今天","new-hr-round",List.of()));
        var session=new ChatSession(base.session().uid(),"","测试HR","测试公司","采购","","新的问题","今天");
        var fresh=new ChatCapture("new-source",1,session,messages,false,true);assertThat(background.resolveConversation(1L,fresh)).isEqualTo(old);
        String current=background.sourceFingerprint(1L,old,fresh,messages.getLast());
        assertThat(current).isEqualTo(hr.sourceFingerprint(old,messages.getLast()));assertThat(hr.hasHandledSource(old,current,true)).isFalse();
        var original=new ChatCapture("original",1,base.session(),messages.subList(0,2),false,true);
        assertThat(background.sourceFingerprint(1L,old,original,original.messages().getLast()))
                .isEqualTo(db.queryForObject("SELECT source_fingerprint FROM hr_reply_proposal WHERE id=?",String.class,proposal));
    }
    @Test void repeatedMatchingOldRoundsRemainHeldInsteadOfChoosingOne() {
        unknownVisual("visual:old");var base=capture("uid","repeated","采购","请介绍经验");
        var messages=new java.util.ArrayList<>(base.messages());messages.add(new ChatMessage("本人","文本","回复","今天"));messages.add(base.messages().getLast());
        var repeated=new ChatCapture("repeated",1,base.session(),messages,false,true);
        assertThatThrownBy(()->background.resolveConversation(1L,repeated)).isInstanceOf(HrBackgroundStore.IdentityHeldException.class);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_chrome_conversation_alias",Integer.class)).isZero();
    }
    @Test void unmodifiedOldVisualSuggestionSurvivesLongBrowserHistoryForClaimDispatchAndFullReceipt() {
        var baseline=capture("visual:old","baseline","采购","请介绍经验");long conversation=hr.upsertVisualConversation(1L,baseline.session());
        for(var m:baseline.messages())hr.saveMessage(conversation,m,30);
        String original=hr.sourceFingerprint(conversation,baseline.messages().getLast());hr.updateLastInbound(conversation,original);policies.context(conversation,baseline);
        var messages=new java.util.ArrayList<ChatMessage>();
        for(int i=0;i<30;i++)messages.add(new ChatMessage("本人","文本","较早历史 "+i,"昨天","older-"+i,List.of()));
        messages.addAll(baseline.messages().stream().map(m->new ChatMessage(m.from(),m.type(),m.text(),m.time(),"real-"+m.from(),List.of())).toList());
        var identity=new ChatSession("real-uid","","测试HR","测试公司","采购","","请介绍经验","今天");
        var before=new ChatCapture("fresh",1,identity,messages,false,true);assertThat(background.resolveConversation(1L,before)).isEqualTo(conversation);policies.context(conversation,before);
        for(var message:messages)hr.saveMessage(conversation,message,30);
        assertThat(hr.recentMessages(conversation,20)).noneMatch(message->hr.sourceFingerprint(conversation,message).equals(original));
        long proposal=hr.createProposal(1L,conversation,original,new AiDraft(Classification.REPLY,"好的，谢谢","回复",List.of(),List.of(),1));policies.decision(proposal,2,"TEXT","独立审核",true);
        hr.queueSendCommand(1L,proposal,1,"watch");var command=hr.claimSendCommand(1L,"watch");
        assertThat(command.expectedLatestInbound()).isEqualTo(baseline.messages().getLast());
        var actions=new HrReplyActionService(hr,org.mockito.Mockito.mock(HrAssistantEventService.class));actions.setAutopilot(policies,org.mockito.Mockito.mock(HrAutopilotService.class));actions.setBackgroundStore(background);
        actions.dispatch(1L,"watch",command.commandId(),command.leaseToken(),before);
        var afterMessages=new java.util.ArrayList<>(messages);afterMessages.add(new ChatMessage("本人","文本","好的，谢谢","今天","self-new",List.of()));
        var after=new ChatCapture("receipt",0,identity,afterMessages,false,true);
        assertThat(actions.completePersistedBackground(1L,"watch",command.commandId(),command.leaseToken(),"SENT","完整新本人消息",null,after).status()).isEqualTo("SENT_CONFIRMED");
    }
    @Test void dispatchCheckpointIsEncryptedAndCanOnlyBeReservedOnce() {
        var capture=capture("uid","c","采购","请介绍经验");long conversation=hr.upsertConversation(1L,capture.session());
        for(var m:capture.messages())hr.saveMessage(conversation,m,30);
        String source=hr.sourceFingerprint(conversation,capture.messages().getLast());hr.updateLastInbound(conversation,source);
        long proposal=hr.createProposal(1L,conversation,source,new AiDraft(Classification.REPLY,"好的，谢谢","回复",List.of(),List.of(),1));
        hr.queueSendCommand(1L,proposal,1,"watch");var command=hr.claimSendCommand(1L,"watch");
        assertThatThrownBy(()->hr.dispatchSendCommand(1L,"watch",command.commandId(),"wrong",capture)).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        hr.dispatchSendCommand(1L,"watch",command.commandId(),command.leaseToken(),capture);
        assertThat(hr.beforeDispatch(1L,"watch",command.commandId(),command.leaseToken())).isEqualTo(capture);
        assertThat(db.queryForObject("SELECT before_capture_cipher FROM hr_send_command",String.class)).doesNotContain("请介绍经验");
        assertThatThrownBy(()->hr.dispatchSendCommand(1L,"watch",command.commandId(),command.leaseToken(),capture)).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        db.update("UPDATE hr_send_command SET lease_expires_at=datetime('now','-1 minute')");hr.expireUnconfirmedLeases();
        assertThat(hr.getProposalView(1L,proposal).status()).isEqualTo("SEND_UNKNOWN");
        assertThat(hr.backgroundCommandStatus(1L,"watch",command.commandId(),command.leaseToken()).get("state")).isEqualTo("UNKNOWN");
        assertThatThrownBy(()->hr.backgroundCommandStatus(1L,"watch",command.commandId(),"wrong")).isInstanceOf(HrAssistantStore.StaleProposalException.class);
        hr.resumePendingCommands(1L,"new-watch");assertThat(hr.claimSendCommand(1L,"new-watch")).isNull();
    }
}
