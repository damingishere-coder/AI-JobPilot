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
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class HrAssistantControllerTest {
    @Test
    void rejectsSendWithoutFreshLocalActionToken() {
        ProfileService profiles = mock(ProfileService.class);
        HrAssistantStore store = mock(HrAssistantStore.class);
        HrAssistantWatchService watcher = mock(HrAssistantWatchService.class);
        HrReplyActionService actions = mock(HrReplyActionService.class);
        HrAssistantEventService events = mock(HrAssistantEventService.class);
        LocalActionTokenService tokens = new LocalActionTokenService();
        HrAssistantController controller = new HrAssistantController(profiles, store, watcher, actions, events, tokens);
        HrAssistantController.ProposalActionRequest request = new HrAssistantController.ProposalActionRequest();
        request.setExpectedVersion(1);

        var response = controller.send(9L, "invalid-token", request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        verifyNoInteractions(actions, profiles, store, watcher, events);
    }

    @Test
    void mapsGroupNotificationSettingsWithoutExposingSecrets() {
        ProfileService profiles = mock(ProfileService.class);
        HrAssistantStore store = mock(HrAssistantStore.class);
        HrAssistantWatchService watcher = mock(HrAssistantWatchService.class);
        HrReplyActionService actions = mock(HrReplyActionService.class);
        HrAssistantEventService events = mock(HrAssistantEventService.class);
        LocalActionTokenService tokens = new LocalActionTokenService();
        HrAssistantController controller = new HrAssistantController(profiles, store, watcher, actions, events, tokens);
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
        verify(store).saveSettings(1L, communication, true, "ws://127.0.0.1:3001", "token-secret",
                QqTargetType.GROUP, "987654321", "123456", 30);
    }

    @Test
    void rejectsSettingsSaveWhenActiveProfileChanged() {
        ProfileService profiles = mock(ProfileService.class);
        HrAssistantStore store = mock(HrAssistantStore.class);
        HrAssistantWatchService watcher = mock(HrAssistantWatchService.class);
        HrReplyActionService actions = mock(HrReplyActionService.class);
        HrAssistantEventService events = mock(HrAssistantEventService.class);
        LocalActionTokenService tokens = new LocalActionTokenService();
        HrAssistantController controller = new HrAssistantController(profiles, store, watcher, actions, events, tokens);
        HrAssistantController.SettingsRequest request = new HrAssistantController.SettingsRequest();
        request.setExpectedProfileId(1L);
        when(profiles.getCurrentProfileId()).thenReturn(2L);

        var response = controller.saveSettings(tokens.issueToken(), request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        verifyNoInteractions(store);
    }
}
