package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class NapCatGatewayTest {
    private final ProfileService profileService = mock(ProfileService.class);
    private final HrAssistantStore store = mock(HrAssistantStore.class);
    private final HrReplyActionService actions = mock(HrReplyActionService.class);
    private final NapCatGateway gateway = new NapCatGateway(profileService, store, actions, new ObjectMapper());

    @Test
    void rejectsGroupUnauthorizedAndOwnMessages() {
        gateway.handleIncoming(1L, "123456", event("group", "123456", "999999", "m1", "发送 1234"));
        gateway.handleIncoming(1L, "123456", event("private", "888888", "999999", "m2", "发送 1234"));
        gateway.handleIncoming(1L, "123456", event("private", "999999", "999999", "m3", "发送 1234"));

        verify(store, never()).rememberQqCommand(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        verify(actions, never()).sendByCode(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void duplicateCommandIsIgnoredAndValidCommandRoutesOnce() {
        String payload = event("private", "123456", "999999", "m4", "发送 1234");
        when(store.rememberQqCommand("m4", "123456", "发送")).thenReturn(true, false);
        when(actions.sendByCode(1L, "1234")).thenReturn(proposal());

        gateway.handleIncoming(1L, "123456", payload);
        gateway.handleIncoming(1L, "123456", payload);

        verify(actions).sendByCode(1L, "1234");
    }

    private String event(String messageType, String userId, String selfId, String messageId, String text) {
        return """
                {"post_type":"message","message_type":"%s","user_id":"%s","self_id":"%s","message_id":"%s","raw_message":"%s"}
                """.formatted(messageType, userId, selfId, messageId, text);
    }

    private ProposalView proposal() {
        return new ProposalView(10L, 1L, 20L, "1234", "SENT_CONFIRMED", "REPLY", "HR", "公司", "岗位",
                "消息", "回复", "摘要", List.of(), List.of(), 0.9, 3,
                LocalDateTime.now().plusMinutes(10), LocalDateTime.now(), false);
    }
}
