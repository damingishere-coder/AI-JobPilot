package com.getjobs.application.controller;

import com.getjobs.application.hr.HrAssistantTypes.CommunicationProfile;
import com.getjobs.application.hr.HrAssistantTypes.QqTargetType;
import com.getjobs.application.hr.HrAssistantTypes.SettingsView;
import com.getjobs.application.service.HrAssistantEventService;
import com.getjobs.application.service.HrAssistantStore;
import com.getjobs.application.service.HrAssistantWatchService;
import com.getjobs.application.service.HrReplyActionService;
import com.getjobs.application.service.LocalActionTokenService;
import com.getjobs.application.service.ProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class HrAssistantControllerTest {
    private final ProfileService profiles = mock(ProfileService.class);
    private final HrAssistantStore store = mock(HrAssistantStore.class);
    private final HrAssistantWatchService watcher = mock(HrAssistantWatchService.class);
    private final HrReplyActionService actions = mock(HrReplyActionService.class);
    private final HrAssistantEventService events = mock(HrAssistantEventService.class);
    private final LocalActionTokenService tokens = new LocalActionTokenService();
    private HrAssistantController controller;

    @BeforeEach
    void setUp() {
        controller = new HrAssistantController(profiles, store, watcher, actions, events, tokens);
    }

    @Test
    void startsTheExactChromeTabOnlyWithFreshLocalActionToken() {
        HrAssistantController.WatchStartRequest request = new HrAssistantController.WatchStartRequest();
        request.setTabId(77);
        request.setUrl("https://www.zhipin.com/web/geek/chat");
        request.setContentVersion("direct");
        request.setBrowserSessionId("browser-session");
        request.setExpectedProfileId(1L);

        var rejected = controller.start("invalid-token", request);
        var accepted = controller.start(tokens.issueToken(), request);

        assertThat(rejected.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(responseBody(rejected)).containsKeys("success", "errorCode", "message", "requestId");
        assertThat(accepted.getStatusCode()).isEqualTo(HttpStatus.OK);
        verify(watcher).start(77, "https://www.zhipin.com/web/geek/chat", "direct", "browser-session", 1L, 1, 0);
        verifyNoInteractions(actions, profiles, store, events);
    }

    @Test
    void visualStatusOnlyReadsAndMutationsRejectMissingToken() throws Exception {
        var visual = mock(com.getjobs.application.service.HrVisualService.class);
        controller.setVisual(visual);
        when(profiles.getCurrentProfileId()).thenReturn(4L);
        when(visual.status(4L)).thenReturn(Map.of("status", "IDLE"));
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/hr-assistant/visual/status"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.status").value("IDLE"));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/hr-assistant/visual/start")
                        .contentType("application/json").content("{}"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isUnauthorized());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/hr-assistant/visual/run/resume"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isUnauthorized());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/hr-assistant/visual/run/targets/target/reconfirm")
                        .contentType("application/json").content("{}"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isUnauthorized());
        verify(visual).status(4L);
        org.mockito.Mockito.verifyNoMoreInteractions(visual);
        verifyNoInteractions(store, watcher, actions, events);
    }

    @Test
    void authorizationGuardRequiresPostAndLocalTokenBeforeReadingPolicy() throws Exception {
        var policies=mock(com.getjobs.application.service.HrAutopilotStore.class);
        controller.setAutopilot(policies);
        var mvc=org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/hr-assistant/autopilot/guard"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isMethodNotAllowed());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/hr-assistant/autopilot/guard"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isUnauthorized());
        verifyNoInteractions(policies,profiles);
        when(profiles.getCurrentProfileId()).thenReturn(1L);
        when(policies.policy(1L)).thenReturn(com.getjobs.application.service.HrAutopilotStore.Policy.defaults());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/hr-assistant/autopilot/guard")
                .header(LocalActionTokenService.HEADER_NAME,tokens.issueToken()))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
        verify(policies).authorizationValid(1L);
    }

    @Test
    void validatesBoundSessionBeforeClaimingSendCommand() {
        when(profiles.getCurrentProfileId()).thenReturn(1L);
        HrAssistantController.SendCommandClaimRequest request = new HrAssistantController.SendCommandClaimRequest();
        request.setWatchSessionId("watch-1");
        request.setTabId(77);

        when(watcher.withSession(org.mockito.ArgumentMatchers.eq(1L), org.mockito.ArgumentMatchers.eq("watch-1"),
                org.mockito.ArgumentMatchers.eq(77), org.mockito.ArgumentMatchers.eq(false), org.mockito.ArgumentMatchers.any()))
                .thenAnswer(call -> ((java.util.function.Supplier<?>) call.getArgument(4)).get());
        var response = controller.claimSendCommand(tokens.issueToken(), request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        verify(watcher).withSession(org.mockito.ArgumentMatchers.eq(1L), org.mockito.ArgumentMatchers.eq("watch-1"),
                org.mockito.ArgumentMatchers.eq(77), org.mockito.ArgumentMatchers.eq(false), org.mockito.ArgumentMatchers.any());
        verify(actions).claim(1L, "watch-1");
    }

    @Test
    void rejectsSendWithoutFreshLocalActionToken() {
        HrAssistantController.ProposalActionRequest request = new HrAssistantController.ProposalActionRequest();
        request.setExpectedVersion(1);

        var response = controller.send(9L, "invalid-token", request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        verifyNoInteractions(actions, profiles, store, watcher, events);
    }

    @Test
    void mapsGroupNotificationSettingsWithoutExposingSecrets() {
        CommunicationProfile communication = CommunicationProfile.empty();
        SettingsView view = new SettingsView(1L, communication, true, "ws://127.0.0.1:3001",
                QqTargetType.GROUP, "98***21", "12***56", true, true, 30, true);
        HrAssistantController.SettingsRequest request = new HrAssistantController.SettingsRequest();
        request.setCommunicationProfile(communication);
        request.setExpectedProfileId(1L);
        request.setQqEnabled(true);
        request.setNapcatWsUrl("ws://127.0.0.1:3001");
        request.setNapcatToken("token-secret");
        request.setQqTargetType(QqTargetType.GROUP);
        request.setQqTarget("987654321");
        request.setQqOperator("123456");
        when(profiles.getCurrentProfileId()).thenReturn(1L);
        when(store.saveSettings(1L, communication, true, "ws://127.0.0.1:3001", "token-secret",
                QqTargetType.GROUP, "987654321", "123456", 30)).thenReturn(view);

        var response = controller.saveSettings(tokens.issueToken(), request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(responseBody(response)).containsKeys("success", "errorCode", "message", "requestId", "data");
        verify(store).saveSettings(1L, communication, true, "ws://127.0.0.1:3001", "token-secret",
                QqTargetType.GROUP, "987654321", "123456", 30);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> responseBody(org.springframework.http.ResponseEntity<?> response) {
        return (Map<String, Object>) response.getBody();
    }
    @Test
    void trialClaimsOnlyTheReadyScopeAndNeverTheGeneralQueue() {
        when(profiles.getCurrentProfileId()).thenReturn(1L);
        when(watcher.isReviewTrial()).thenReturn(true);
        when(watcher.trialSendScope()).thenReturn(java.util.Set.of());
        when(watcher.withSession(org.mockito.ArgumentMatchers.eq(1L),org.mockito.ArgumentMatchers.eq("trial"),
                org.mockito.ArgumentMatchers.eq(77),org.mockito.ArgumentMatchers.eq(false),org.mockito.ArgumentMatchers.any()))
                .thenAnswer(call -> ((java.util.function.Supplier<?>) call.getArgument(4)).get());
        var request=new HrAssistantController.SendCommandClaimRequest();request.setWatchSessionId("trial");request.setTabId(77);
        assertThat(controller.claimSendCommand(tokens.issueToken(),request).getStatusCode()).isEqualTo(HttpStatus.OK);
        verify(actions).claim(1L,"trial",java.util.Set.of());
        when(watcher.trialSendScope()).thenReturn(java.util.Set.of(101L,102L));
        controller.claimSendCommand(tokens.issueToken(),request);
        verify(actions).claim(1L,"trial",java.util.Set.of(101L,102L));
        org.mockito.Mockito.verify(actions,org.mockito.Mockito.never()).claim(1L,"trial");
    }

}
