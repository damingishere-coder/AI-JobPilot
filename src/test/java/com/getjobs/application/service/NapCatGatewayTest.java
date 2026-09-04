package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.CommunicationProfile;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.QqTargetType;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class NapCatGatewayTest {
    private final ProfileService profileService = mock(ProfileService.class);
    private final HrAssistantStore store = mock(HrAssistantStore.class);
    private final HrReplyActionService actions = mock(HrReplyActionService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final NapCatGateway gateway = new NapCatGateway(profileService, store, actions, objectMapper);

    @Test
    void groupCommandRequiresBothConfiguredGroupAndOperator() {
        when(store.loadSettingsSecret(1L)).thenReturn(groupSettings("123456"));
        when(store.rememberQqCommand("m1", "123456", "发送")).thenReturn(true);
        when(actions.sendByCode(1L, "1234")).thenReturn(proposal());

        gateway.handleIncoming(1L, event("group", "987654321", "123456", "999999", "m1", "发送 1234"));
        gateway.handleIncoming(1L, event("group", "999000111", "123456", "999999", "m2", "发送 1234"));
        gateway.handleIncoming(1L, event("group", "987654321", "888888", "999999", "m3", "发送 1234"));
        gateway.handleIncoming(1L, event("private", "", "123456", "999999", "m4", "发送 1234"));
        gateway.handleIncoming(1L, event("group", "987654321", "999999", "999999", "m5", "发送 1234"));
        gateway.handleIncoming(1L, event("group", "987654321", "123456", "999999", "", "发送 1234"));

        verify(actions).sendByCode(1L, "1234");
        verify(store).rememberQqCommand("m1", "123456", "发送");
    }

    @Test
    void groupWithoutOperatorIsNotificationOnly() {
        when(store.loadSettingsSecret(1L)).thenReturn(groupSettings(""));

        gateway.handleIncoming(1L, event("group", "987654321", "123456", "999999", "m6", "发送 1234"));

        verify(store, never()).rememberQqCommand(any(), any(), any());
        verify(actions, never()).sendByCode(any(), any());
    }

    @Test
    void duplicatePrivateCommandIsIgnoredAndValidCommandRoutesOnce() {
        when(store.loadSettingsSecret(1L)).thenReturn(privateSettings());
        String payload = event("private", "", "123456", "999999", "m7", "发送 1234");
        when(store.rememberQqCommand("m7", "123456", "发送")).thenReturn(true, false);
        when(actions.sendByCode(1L, "1234")).thenReturn(proposal());

        gateway.handleIncoming(1L, payload);
        gateway.handleIncoming(1L, payload);

        verify(actions).sendByCode(1L, "1234");
    }

    @Test
    void buildsOneBotGroupNotification() throws Exception {
        String payload = gateway.buildNotificationPayload(groupSettings(""), "通知正文");
        var json = objectMapper.readTree(payload);

        assertThat(json.path("action").asText()).isEqualTo("send_group_msg");
        assertThat(json.path("params").path("group_id").asLong()).isEqualTo(987654321L);
        assertThat(json.path("params").path("message").asText()).isEqualTo("通知正文");
        assertThat(json.path("params").has("user_id")).isFalse();
    }

    private HrAssistantStore.SettingsSecret groupSettings(String operatorQq) {
        return new HrAssistantStore.SettingsSecret(1L, CommunicationProfile.empty(), true,
                "ws://127.0.0.1:3001", "token", QqTargetType.GROUP, "987654321", operatorQq, 30);
    }

    private HrAssistantStore.SettingsSecret privateSettings() {
        return new HrAssistantStore.SettingsSecret(1L, CommunicationProfile.empty(), true,
                "ws://127.0.0.1:3001", "token", QqTargetType.PRIVATE, "123456", "", 30);
    }

    private String event(String messageType, String groupId, String userId, String selfId,
                         String messageId, String text) {
        return """
                {"post_type":"message","message_type":"%s","group_id":"%s","user_id":"%s","self_id":"%s","message_id":"%s","raw_message":"%s"}
                """.formatted(messageType, groupId, userId, selfId, messageId, text);
    }

    private ProposalView proposal() {
        return new ProposalView(10L, 1L, 20L, "1234", "SENT_CONFIRMED", "REPLY", "HR", "公司", "岗位",
                "消息", "回复", "摘要", List.of(), List.of(), 0.9, 3,
                LocalDateTime.now().plusMinutes(10), LocalDateTime.now(), false);
    }
}
