package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.entity.ProfileEntity;
import com.getjobs.application.hr.HrAssistantTypes.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class HrBackgroundWatchServiceTest {
    @TempDir Path dir;
    JdbcTemplate db;
    HrAssistantStore hr;
    HrAutopilotStore policies;
    HrBackgroundStore queue;
    HrAssistantWatchService watcher;
    HrReplyDraftService drafts;
    AiService ai;
    NapCatGateway qq;
    BackgroundBinding binding;

    @BeforeEach void setup() {
        var ds=new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("watch.db"));
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();db=new JdbcTemplate(ds);
        db.update("INSERT INTO profile(id,name,is_active) VALUES (1,'测试账号',1)");
        var json=new ObjectMapper();var crypto=new HrAssistantCryptoService(dir.resolve("test.key"));
        hr=new HrAssistantStore(db,crypto,json);policies=new HrAutopilotStore(db,json,crypto,hr);queue=new HrBackgroundStore(db,crypto,json,hr,policies);
        hr.saveSettings(1L,CommunicationProfile.empty(),true,"ws://127.0.0.1:3001","test",QqTargetType.GROUP,"123456","234567",30);
        policies.configure(1L,1,true,"","","AUTO",false,false,"RECENT",30);
        drafts=mock(HrReplyDraftService.class);ai=mock(AiService.class);qq=mock(NapCatGateway.class);
        when(qq.isConnected()).thenReturn(true);when(drafts.hasResume(1L)).thenReturn(true);
        when(drafts.history(anyList())).thenReturn("完整来源");when(drafts.trustedFacts(eq(1L),any())).thenReturn("已确认资料");
        when(drafts.generateWithFacts(eq(1L),anyLong(),any(),anyList(),anyString())).thenReturn(reply());
        when(ai.sendStructuredRequest(anyString(),anyString())).thenReturn("{\"allowed\":true,\"evidence\":[],\"reason\":\"礼貌回复\",\"claims\":[]}");
        var media=mock(HrMediaService.class);when(media.resolve(any())).thenAnswer(call->call.getArgument(0));
        var auto=new HrAutopilotService(policies,hr,drafts,ai,json,media);
        var profiles=mock(ProfileService.class);var profile=new ProfileEntity();profile.setId(1L);profile.setName("测试账号");
        when(profiles.getCurrentProfileId()).thenReturn(1L);when(profiles.getCurrentProfile()).thenReturn(profile);
        watcher=new HrAssistantWatchService(profiles,hr,drafts,mock(HrAssistantEventService.class),qq,100,new HrProfileGuard());
        watcher.setAutopilot(auto);watcher.setBackground(queue);watcher.recoverBackground();
        binding=new BackgroundBinding("generation","document","geek:测试账号","测试账号",true,System.currentTimeMillis());
    }
    @AfterEach void stop(){watcher.shutdownBackground();}
    AiDraft reply(){return new AiDraft(Classification.REPLY,"好的，谢谢","普通回复",List.of(),List.of(),1);}
    ChatCapture capture(String id){return new ChatCapture(id,1,new ChatSession("uid-"+id,"","测试HR","测试公司","采购","","方便沟通吗","今天"),
            List.of(new ChatMessage("对方","文本","方便沟通吗","今天")),false,true);}
    WatchStatus start(){return watcher.start(77,"https://www.zhipin.com/web/geek/chat",HrAutopilotStore.PROTOCOL,"browser",1L,1,0,"CHROME_BACKGROUND",binding);}
    PageObservation observation(){return new PageObservation(binding.hostGeneration(),binding.pageDocumentId(),binding.accountIdentity(),System.currentTimeMillis());}
    void waitUntil(java.util.function.BooleanSupplier complete)throws Exception{
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
        while(!complete.getAsBoolean() && System.nanoTime()<deadline)Thread.sleep(10);
        assertThat(complete.getAsBoolean()).isTrue();
    }
    @Test void ackIsIndependentOfSlowAiAndQueuedWorkCompletesAsynchronouslyOnce()throws Exception {
        var status=start();var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
        when(drafts.generateWithFacts(eq(1L),anyLong(),any(),anyList(),anyString())).thenAnswer(call->{entered.countDown();assertThat(release.await(5,TimeUnit.SECONDS)).isTrue();return reply();});
        long before=System.nanoTime();var ack=watcher.acceptCapture(status.watchSessionId(),77,"scan",List.of(capture("first")),observation());
        assertThat(ack.accepted()).isTrue();assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-before)).isLessThan(1000);
        verifyNoInteractions(ai);watcher.processBackgroundCaptures();assertThat(entered.await(2,TimeUnit.SECONDS)).isTrue();
        before=System.nanoTime();var second=watcher.acceptCapture(status.watchSessionId(),77,"scan",List.of(capture("second")),observation());
        assertThat(second.accepted()).isTrue();assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-before)).isLessThan(1000);
        release.countDown();waitUntil(()->db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)==1);
        watcher.acceptCapture(status.watchSessionId(),77,"retry",List.of(capture("first")),observation());
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_background_capture",Integer.class)).isEqualTo(2);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isEqualTo(1);
    }
    @Test void blockedAnalysisIsVisibleWhileTheRealPageRemainsWatching() throws Exception {
        var old=new ChatCapture("old",1,new ChatSession("visual:old","","测试HR","测试公司","采购","","旧问题","昨天"),List.of(new ChatMessage("对方","文本","旧问题","昨天")),false,true);
        long conversation=hr.upsertVisualConversation(1L,old.session());for(var m:old.messages())hr.saveMessage(conversation,m,30);
        String source=hr.sourceFingerprint(conversation,old.messages().getLast());hr.updateLastInbound(conversation,source);policies.context(conversation,old);
        long proposal=hr.createProposal(1L,conversation,source,reply());hr.markFinal(proposal,ProposalStatus.SEND_UNKNOWN,"原回执未知");
        var status=start();watcher.acceptCapture(status.watchSessionId(),77,"blocked",List.of(capture("new")),observation());
        watcher.processBackgroundCaptures();
        waitUntil(()->db.queryForObject("SELECT COUNT(*) FROM hr_background_capture WHERE status='BLOCKED'",Integer.class)==1);
        var current=watcher.status();assertThat(current.watching()).isTrue();assertThat(current.phase()).isEqualTo("WATCHING");
        assertThat(((java.util.Map<?,?>)current.activity().get("background")).get("blockedCaptures")).isEqualTo(1);
        assertThat(current.activity().get("background").toString()).contains("尚未发送");
        var pageBefore=ReflectionTestUtils.getField(watcher,"pageObservedAt");watcher.inspectBackgroundCaptures(20);
        assertThat(ReflectionTestUtils.getField(watcher,"pageObservedAt")).isEqualTo(pageBefore);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();
        assertThat(policies.conversationHeld(conversation)).isTrue();
    }
    @Test void replayedOrOldPageAnchorDoesNotKeepAStaleHostClaimingCommands() {
        var status=start();
        assertThatThrownBy(()->watcher.heartbeat(status.watchSessionId(),77,status.chromeBridge().url(),HrAutopilotStore.PROTOCOL,false,0,"",
                new PageObservation("other-generation","document","测试账号",System.currentTimeMillis())))
                .isInstanceOf(HrAssistantStore.StaleProposalException.class);
        ReflectionTestUtils.setField(watcher,"pageObservedAt",System.currentTimeMillis()-120_001);
        assertThat(watcher.status().watching()).isFalse();assertThat(watcher.status().blockerCode()).isEqualTo("PAGE_HEARTBEAT_EXPIRED");
        assertThatThrownBy(()->watcher.withSession(1L,status.watchSessionId(),77,false,observation(),()->true)).hasMessageContaining("WATCH_SESSION_EXPIRED");
    }
    @Test void sameMillisecondHeartbeatDoesNotExtendLivenessAndFaultReportsNeverDo() {
        var status=start();long original=binding.pageObservedAt();
        watcher.heartbeat(status.watchSessionId(),77,status.chromeBridge().url(),HrAutopilotStore.PROTOCOL,false,0,"",
                new PageObservation(binding.hostGeneration(),binding.pageDocumentId(),binding.accountIdentity(),original));
        assertThat(ReflectionTestUtils.getField(watcher,"pageObservedAt")).isEqualTo(original);
        watcher.reportFault(status.watchSessionId(),binding.hostGeneration(),binding.accountIdentity(),"PAGE_FROZEN");
        watcher.reportFault(status.watchSessionId(),binding.hostGeneration(),binding.accountIdentity(),"PAGE_FROZEN");
        assertThat(watcher.status().blockerCode()).isEqualTo("PAGE_FROZEN");
        assertThat(ReflectionTestUtils.getField(watcher,"pageObservedAt")).isEqualTo(original);
        verify(qq,times(1)).notifySystemFault(eq(1L),anyString());
        watcher.stop(status.watchSessionId(),"USER_STOPPED");assertThat(watcher.isBackgroundForProfile(1L)).isFalse();
    }
    @Test void stopWhileAiRunsRetainsAnalysisForAReboundSessionWithoutSending()throws Exception {
        var status=start();var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
        when(drafts.generateWithFacts(eq(1L),anyLong(),any(),anyList(),anyString())).thenAnswer(call->{entered.countDown();release.await(5,TimeUnit.SECONDS);return reply();});
        watcher.acceptCapture(status.watchSessionId(),77,"scan",List.of(capture("first")),observation());watcher.processBackgroundCaptures();
        assertThat(entered.await(2,TimeUnit.SECONDS)).isTrue();watcher.stop(status.watchSessionId(),"USER_STOPPED");release.countDown();
        waitUntil(()->"PENDING".equals(db.queryForObject("SELECT status FROM hr_background_capture",String.class)));
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();
        waitUntil(()->!watcher.status().profileSwitchBlocked());binding=new BackgroundBinding("generation","document","geek:测试账号","测试账号",true,System.currentTimeMillis());
        var resumed=start();assertThat(resumed.watchSessionId()).isNotEqualTo(status.watchSessionId());
        watcher.processBackgroundCaptures();waitUntil(()->db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)==1);
    }
    @Test void incompleteReadIsAcknowledgedAndRoutesToHumanWithoutAiOrSend()throws Exception {
        var status=start();var c=capture("incomplete");c=new ChatCapture(c.captureId(),c.unreadCount(),c.session(),c.messages(),false,false);
        assertThat(watcher.acceptCapture(status.watchSessionId(),77,"scan",List.of(c),observation()).accepted()).isTrue();
        watcher.processBackgroundCaptures();waitUntil(()->"DONE".equals(db.queryForObject("SELECT status FROM hr_background_capture",String.class)));
        verify(drafts,never()).generateWithFacts(any(),anyLong(),any(),anyList(),anyString());verifyNoInteractions(ai);
        verify(qq).notifyProposal(any());assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isZero();
        watcher.acceptCapture(status.watchSessionId(),77,"reread",List.of(capture("incomplete")),observation());
        waitUntil(()->!watcher.status().phase().equals("ANALYZING"));
        watcher.processBackgroundCaptures();waitUntil(()->db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)==1);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_reply_proposal WHERE status='EXPIRED'",Integer.class)).isEqualTo(1);
    }
}
