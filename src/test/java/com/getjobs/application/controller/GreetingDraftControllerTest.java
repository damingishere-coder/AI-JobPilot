package com.getjobs.application.controller;

import com.getjobs.application.service.GreetingDraftService;
import com.getjobs.application.service.LocalActionTokenService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class GreetingDraftControllerTest {

    @Test
    void rejectsDraftMutationWithoutValidLocalToken() {
        GreetingDraftService greetingDraftService = mock(GreetingDraftService.class);
        LocalActionTokenService tokenService = new LocalActionTokenService();
        GreetingDraftController controller = new GreetingDraftController(greetingDraftService, tokenService);
        GreetingDraftController.GreetingDraftRequest request = new GreetingDraftController.GreetingDraftRequest();
        request.setContent("新的人工沟通稿");

        ResponseEntity<?> response = controller.save("boss", 1L, "invalid-token", request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        verifyNoInteractions(greetingDraftService);
    }
}
