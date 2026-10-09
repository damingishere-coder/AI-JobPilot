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
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class NapCatGatewayTest {
    private final ProfileService profileService = mock(ProfileService.class);
    private final HrAssistantStore store = mock(HrAssistantStore.class);
    private final HrReplyActionService actions = mock(HrReplyActionService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final NapCatGateway gateway = new NapCatGateway(profileService, store, actions, objectMapper);

    @Test
    void connectionIdentityIncludesProfileAndStaleSocketCannotDrainAnotherProfilesQueue() {
        var settings=groupSettings("123456");
        String first=org.springframework.test.util.ReflectionTestUtils.invokeMethod(gateway,"fingerprint",1L,settings);
        String second=org.springframework.test.util.ReflectionTestUtils.invokeMethod(gateway,"fingerprint",2L,settings);
        assertThat(first).isNotEqualTo(second);
        var outbox=mock(HrAutopilotStore.class);
        gateway.setAutopilot(outbox);
        var socket=mock(java.net.http.WebSocket.class);
        org.springframework.test.util.ReflectionTestUtils.setField(gateway,"socket",socket);
        org.springframework.test.util.ReflectionTestUtils.setField(gateway,"connectionFingerprint",first);
        when(profileService.getCurrentProfileIdOrNull()).thenReturn(2L);
        when(store.loadSettingsSecret(2L)).thenReturn(settings);
        gateway.flushNotifications();
        verify(outbox,never()).pending(any());
        verify(socket,never()).sendText(any(),org.mockito.ArgumentMatchers.anyBoolean());
    }

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
        assertThat(json.path("params").path("message").get(0).path("data").path("text").asText()).isEqualTo("通知正文");
        assertThat(json.path("params").has("user_id")).isFalse();
    }

    @Test
    void onlySuccessfulReceiptWithMessageIdConfirmsDelivery() {
        var outbox=mock(HrAutopilotStore.class);gateway.setAutopilot(outbox);
        when(store.loadSettingsSecret(1L)).thenReturn(groupSettings("123456"));
        gateway.handleIncoming(1L,"{\"echo\":\"hr-delivery:delivery-1\",\"retcode\":0,\"status\":\"ok\",\"data\":{\"message_id\":12345}}");
        gateway.handleIncoming(1L,"{\"echo\":\"hr-delivery:delivery-2\",\"retcode\":0,\"status\":\"ok\",\"data\":{}}");
        verify(outbox).receipt("delivery-1",true,"12345");
        verify(outbox).receipt("delivery-2",false,"");
    }

    @Test
    void wrongGroupCannotPauseOrRememberFacts() {
        var outbox=mock(HrAutopilotStore.class);gateway.setAutopilot(outbox);
        when(store.loadSettingsSecret(1L)).thenReturn(groupSettings("123456"));
        gateway.handleIncoming(1L,event("group","111111","123456","999999","pause1","暂停"));
        gateway.handleIncoming(1L,event("group","987654321","777777","999999","remember1","记住 不真实经历"));
        verifyNoInteractions(outbox);
    }
    @Test
    void authorizedQqCanPauseVisualWhenAutomaticDutyIsDisabled() {
        var outbox=mock(HrAutopilotStore.class);gateway.setAutopilot(outbox);
        var visual=mock(HrVisualService.class);gateway.setVisual(visual);
        when(store.loadSettingsSecret(1L)).thenReturn(groupSettings("123456"));
        when(store.rememberQqCommand("visual-pause","123456","托管指令")).thenReturn(true);
        when(visual.qqControl(1L,false)).thenReturn(true);
        gateway.handleIncoming(1L,event("group","987654321","123456","999999","visual-pause","暂停"));
        verify(visual).qqControl(1L,false);verify(outbox,never()).pause(any(),org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    void reviewCardContainsEntireHrRoundSuggestionAndConfirmationInstructions() throws Exception {
        var outbox=mock(HrAutopilotStore.class);gateway.setAutopilot(outbox);
        when(store.loadSettingsSecret(1L)).thenReturn(groupSettings("123456"));
        var capture=new com.getjobs.application.hr.HrAssistantTypes.ChatCapture("c",1,null,List.of(
                new com.getjobs.application.hr.HrAssistantTypes.ChatMessage("本人","文本","旧回复","昨天"),
                new com.getjobs.application.hr.HrAssistantTypes.ChatMessage("对方","文本","第一个问题","今天"),
                new com.getjobs.application.hr.HrAssistantTypes.ChatMessage("对方","文本","第二个问题","今天")),false,true);
        when(outbox.context(1L,20L)).thenReturn(capture);
        assertThat(gateway.notifyProposal(proposal())).isTrue();
        var payload=org.mockito.ArgumentCaptor.forClass(String.class);
        verify(outbox).enqueue(org.mockito.ArgumentMatchers.eq(1L),org.mockito.ArgumentMatchers.eq("proposal:10:3:0"),payload.capture());
        String text=objectMapper.readTree(payload.getValue()).path("params").path("message").get(0).path("data").path("text").asText();
        assertThat(text).contains("回复确认卡","第一个问题","第二个问题","建议回复 / 动作","回复","发送 1234","尚未发送给 HR").doesNotContain("旧回复");
        verifyNoInteractions(actions);
    }

    @Test
    void reviewNoticeSynchronizesReadableMediaAsTextWithoutForwardingAnyRawFiles() throws Exception {
        var outbox=mock(HrAutopilotStore.class);gateway.setAutopilot(outbox);
        when(store.loadSettingsSecret(1L)).thenReturn(groupSettings("123456"));
        var image=new com.getjobs.application.hr.HrAssistantTypes.MediaContent("图片","image/png","data:image/png;base64,cGlj",
                "https://example.invalid/photo.png","READABLE","明天下午可以面试吗？");
        var audio=new com.getjobs.application.hr.HrAssistantTypes.MediaContent("语音","audio/ogg","data:audio/ogg;base64,YXVkaW8=",
                "https://example.invalid/voice.ogg","UNREADABLE","内部读取错误");
        var capture=new com.getjobs.application.hr.HrAssistantTypes.ChatCapture("c",1,null,List.of(
                new com.getjobs.application.hr.HrAssistantTypes.ChatMessage("本人","文本","旧回复","昨天"),
                new com.getjobs.application.hr.HrAssistantTypes.ChatMessage("对方","图片","","今天","m1",List.of(image)),
                new com.getjobs.application.hr.HrAssistantTypes.ChatMessage("对方","语音","","今天","m2",List.of(audio))),false,true);
        when(outbox.context(1L,20L)).thenReturn(capture);
        assertThat(gateway.notifyProposal(proposal())).isTrue();
        var payload=org.mockito.ArgumentCaptor.forClass(String.class);
        verify(outbox).enqueue(org.mockito.ArgumentMatchers.eq(1L),org.mockito.ArgumentMatchers.eq("proposal:10:3:0"),payload.capture());
        var segments=objectMapper.readTree(payload.getValue()).path("params").path("message");
        assertThat(segments).hasSize(1);
        assertThat(segments.get(0).path("type").asText()).isEqualTo("text");
        assertThat(segments.get(0).path("data").path("text").asText())
                .contains("明天下午可以面试吗？","语音尚未完整读取","QQ 仅同步文字","当前不能确认发送")
                .doesNotContain("base64://","data:image","内部读取错误","旧回复","确认发送：发送");
        verifyNoInteractions(actions);
    }

    @Test
    void incompleteCaptureShowsKnownSourceAndContactWithoutOfferingToSendAnEmptyDraft() throws Exception {
        var outbox=mock(HrAutopilotStore.class);gateway.setAutopilot(outbox);
        when(store.loadSettingsSecret(1L)).thenReturn(groupSettings("123456"));
        var session=new com.getjobs.application.hr.HrAssistantTypes.ChatSession("uid","","合成HR","合成公司","","",
                "不好意思，不太合适哦","今天");
        var logo=new com.getjobs.application.hr.HrAssistantTypes.MediaContent("其他","image/png","data:image/png;base64,cGlj",
                "https://example.invalid/logo.png","READABLE","无可见文字或卡片字段。");
        var capture=new com.getjobs.application.hr.HrAssistantTypes.ChatCapture("c",1,session,List.of(
                new com.getjobs.application.hr.HrAssistantTypes.ChatMessage("对方","其他","","今天","m0",List.of(logo)),
                new com.getjobs.application.hr.HrAssistantTypes.ChatMessage("对方","文本","不好意思，不太合适哦","今天")),false,false);
        when(outbox.context(1L,20L)).thenReturn(capture);
        var incomplete=new ProposalView(10L,1L,20L,"1234","REVIEW_REQUIRED","NEEDS_USER","","","",
                "不好意思，不太合适哦","","聊天正文未完整读取",List.of("INCOMPLETE_CONTEXT"),List.of("完整聊天正文"),0,3,
                LocalDateTime.now().plusMinutes(10),LocalDateTime.now(),false);
        assertThat(gateway.notifyProposal(incomplete)).isTrue();
        var payload=org.mockito.ArgumentCaptor.forClass(String.class);
        verify(outbox).enqueue(org.mockito.ArgumentMatchers.eq(1L),org.mockito.ArgumentMatchers.eq("proposal:10:3:0"),payload.capture());
        String text=objectMapper.readTree(payload.getValue()).path("params").path("message").get(0).path("data").path("text").asText();
        assertThat(text).contains("合成公司","合成HR","不好意思，不太合适哦","上下文或媒体尚未完整读取","暂不生成回复",
                "详情 1234","补充 1234 本次事实","其他类型卡片").doesNotContain("确认发送：发送","调整：修改","无可见文字","base64");
    }

    @Test
    void notificationDispatcherRejectsLegacyQueuedMediaBeforeAnyWebsocketWrite() {
        var outbox=mock(HrAutopilotStore.class);gateway.setAutopilot(outbox);
        var socket=mock(java.net.http.WebSocket.class);
        var settings=groupSettings("123456");
        when(profileService.getCurrentProfileIdOrNull()).thenReturn(1L);
        when(store.loadSettingsSecret(1L)).thenReturn(settings);
        org.springframework.test.util.ReflectionTestUtils.setField(gateway,"socket",socket);
        String fingerprint=org.springframework.test.util.ReflectionTestUtils.invokeMethod(gateway,"fingerprint",1L,settings);
        org.springframework.test.util.ReflectionTestUtils.setField(gateway,"connectionFingerprint",fingerprint);
        var delivery=new HrAutopilotStore.Delivery("legacy-media",1L,"""
                {"action":"send_group_msg","params":{"group_id":987654321,"message":[{"type":"image","data":{"file":"base64://cGlj"}}]}}
                """);
        when(outbox.pending(1L)).thenReturn(List.of(delivery));
        when(outbox.dispatching("legacy-media")).thenReturn(true);
        gateway.flushNotifications();
        verify(outbox).receipt("legacy-media",false,"");
        verify(socket,never()).sendText(any(),org.mockito.ArgumentMatchers.anyBoolean());
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
