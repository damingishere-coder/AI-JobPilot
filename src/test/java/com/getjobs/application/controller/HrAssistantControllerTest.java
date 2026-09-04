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

        var rejected = controller.start("invalid-token", request);
        var accepted = controller.start(tokens.issueToken(), request);

        assertThat(rejected.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(responseBody(rejected)).containsKeys("success", "errorCode", "message", "requestId");
        assertThat(accepted.getStatusCode()).isEqualTo(HttpStatus.OK);
        verify(watcher).start(77, "https://www.zhipin.com/web/geek/chat", "direct", "browser-session");
        verifyNoInteractions(actions, profiles, store, events);
    }

    @Test
    void validatesBoundSessionBeforeClaimingSendCommand() {
        when(profiles.getCurrentProfileId()).thenReturn(1L);
        HrAssistantController.SendCommandClaimRequest request = new HrAssistantController.SendCommandClaimRequest();
        request.setWatchSessionId("watch-1");
        request.setTabId(77);

        var response = controller.claimSendCommand(tokens.issueToken(), request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        verify(watcher).assertActiveSession(1L, "watch-1", 77);
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
}
