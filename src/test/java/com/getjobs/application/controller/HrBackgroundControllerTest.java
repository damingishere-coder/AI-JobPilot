package com.getjobs.application.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.entity.ProfileEntity;
import com.getjobs.application.hr.HrAssistantTypes.*;
import com.getjobs.application.service.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.file.Path;
import java.util.List;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class HrBackgroundControllerTest {
    @TempDir Path dir;
    JdbcTemplate db;
    HrAssistantStore store;
    HrAutopilotStore policies;
    HrAssistantWatchService watcher;
    HrAssistantController controller;
    LocalActionTokenService tokens;
    WatchStatus started;
    BackgroundBinding binding;

    @BeforeEach void setup() {
        var ds=new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("controller.db"));
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();db=new JdbcTemplate(ds);
        db.update("INSERT INTO profile(id,name,is_active) VALUES (1,'本人',1)");
        var json=new ObjectMapper();var crypto=new HrAssistantCryptoService(dir.resolve("test.key").toString());store=new HrAssistantStore(db,crypto,json);
        store.saveSettings(1L,CommunicationProfile.empty(),true,"ws://127.0.0.1:3001","test",QqTargetType.GROUP,"123456","234567",30);
        policies=new HrAutopilotStore(db,json,crypto,store);policies.configure(1L,1,true,"","","AUTO",false,false,"RECENT",30);
        var profiles=mock(ProfileService.class);var profile=new ProfileEntity();profile.setId(1L);profile.setName("本人");
        when(profiles.getCurrentProfileId()).thenReturn(1L);when(profiles.getCurrentProfile()).thenReturn(profile);
        var auto=mock(HrAutopilotService.class);when(auto.policy(1L)).thenAnswer(call->policies.policy(1L));
        when(auto.blockers(1L)).thenReturn(List.of());var qq=mock(NapCatGateway.class);when(qq.isConnected()).thenReturn(true);
        var guard=new HrProfileGuard();var events=mock(HrAssistantEventService.class);
        watcher=new HrAssistantWatchService(profiles,store,mock(HrReplyDraftService.class),events,qq,100,guard);watcher.setAutopilot(auto);
        var actions=new HrReplyActionService(store,events);actions.setAutopilot(policies,auto);
        tokens=new LocalActionTokenService();controller=new HrAssistantController(profiles,store,watcher,actions,events,tokens);
        controller.setAutopilot(policies);controller.setProfileGuard(guard);
        binding=new BackgroundBinding("gen","doc","geek:本人","本人",true,System.currentTimeMillis());
        started=watcher.start(77,"https://www.zhipin.com/web/geek/chat",HrAutopilotStore.PROTOCOL,"browser",1L,1,0,"CHROME_BACKGROUND",binding);
    }
    @AfterEach void shutdown(){ReflectionTestUtils.invokeMethod(watcher,"shutdownBackground");}
    HrAssistantController.SendCommandClaimRequest anchored() {
        var request=new HrAssistantController.SendCommandClaimRequest();request.setWatchSessionId(started.watchSessionId());request.setTabId(77);
        request.setHostGeneration("gen");request.setPageDocumentId("doc");request.setAccountIdentity("geek:本人");request.setPageObservedAt(System.currentTimeMillis());return request;
    }
    @Test void guardRequiresCurrentPageSessionAndStopsAfterBackendStop() {
        var request=anchored();assertThat(controller.guard(tokens.issueToken(),request).getStatusCode()).isEqualTo(HttpStatus.OK);
        request.setHostGeneration("wrong");assertThat(controller.guard(tokens.issueToken(),request).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        request=anchored();ReflectionTestUtils.setField(watcher,"pageObservedAt",System.currentTimeMillis()-120_001);
        assertThat(controller.guard(tokens.issueToken(),request).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    }
    @Test void disablingIsAlwaysAvailableAndLateReceiptKeepsTheAlreadyDispatchedLease() {
        var capture=new ChatCapture("c",1,new ChatSession("uid","","HR","公司","采购","","你好","今天"),List.of(new ChatMessage("对方","文本","你好","今天")),false,true);
        long conversation=store.upsertConversation(1L,capture.session());store.saveMessage(conversation,capture.messages().getFirst(),30);
        String source=store.sourceFingerprint(conversation,capture.messages().getFirst());store.updateLastInbound(conversation,source);policies.context(conversation,capture);
        long proposal=store.createProposal(1L,conversation,source,new AiDraft(Classification.REPLY,"好的，谢谢","回复",List.of(),List.of(),1));
        policies.decision(proposal,policies.policy(1L).version(),"TEXT","已审核",true);
        store.queueSendCommand(1L,proposal,1,started.watchSessionId());var command=store.claimSendCommand(1L,started.watchSessionId());
        store.dispatchSendCommand(1L,started.watchSessionId(),command.commandId(),command.leaseToken(),capture);
        int clientVersion=policies.policy(1L).version();
        policies.remember(1L,"已确认事实",false);policies.remember(1L,"已确认事实",true);policies.remember(1L,"待确认事实",false);
        var latest=policies.policy(1L);
        var disable=new HrAssistantController.AutopilotRequest(1L,clientVersion,false,false,"ignored","ignored","INVALID",true,true,"INVALID",90);
        assertThat(controller.saveAutopilot(tokens.issueToken(),disable).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(policies.policy(1L).enabled()).isFalse();assertThat(watcher.status().watching()).isFalse();
        assertThat(store.hasLeasedSendCommands()).isTrue();assertThat(policies.policy(1L).shareResume()).isFalse();
        assertThat(policies.policy(1L).facts()).isEqualTo(latest.facts());assertThat(policies.policy(1L).pendingFact()).isEqualTo(latest.pendingFact());
        assertThat(policies.policy(1L).replyMode()).isEqualTo(latest.replyMode());assertThat(policies.policy(1L).historyMode()).isEqualTo(latest.historyMode());
        assertThat(controller.guard(tokens.issueToken(),anchored()).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        var result=new HrAssistantController.SendCommandResultRequest();result.setWatchSessionId(started.watchSessionId());result.setTabId(77);result.setHostGeneration("gen");result.setLeaseToken(command.leaseToken());result.setOutcome("SENT");
        result.setObservedCapture(new ChatCapture("after",0,capture.session(),List.of(capture.messages().getFirst(),new ChatMessage("本人","文本","好的，谢谢","今天")),false,true));
        assertThat(controller.completeSendCommand(command.commandId(),tokens.issueToken(),result).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(store.getProposalView(1L,proposal).status()).isEqualTo("SENT_CONFIRMED");
        assertThat(controller.completeSendCommand(command.commandId(),tokens.issueToken(),result).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_send_command",Integer.class)).isEqualTo(1);
    }
}
