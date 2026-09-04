package com.getjobs.application.controller;

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
import static org.mockito.Mockito.verifyNoInteractions;

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
}
