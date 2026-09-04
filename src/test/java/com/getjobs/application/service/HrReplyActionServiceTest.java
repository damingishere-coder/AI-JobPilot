package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import com.getjobs.application.hr.HrAssistantTypes.ProposalStatus;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HrReplyActionServiceTest {
    private final HrAssistantStore store = mock(HrAssistantStore.class);
    private final OpenCliBossGateway gateway = mock(OpenCliBossGateway.class);
    private final HrAssistantEventService events = mock(HrAssistantEventService.class);
    private final HrReplyActionService service = new HrReplyActionService(store, gateway, events);

    @Test
    void latestInboundChangeBlocksSendBeforeAnyDomWrite() {
        var record = record("old-fingerprint");
        ChatSession session = session("新消息");
        ChatMessage inbound = new ChatMessage("对方", "文本", "新消息", "11:03");
        when(store.requireProposal(1L, 10L)).thenReturn(record);
        when(gateway.listChats(100)).thenReturn(List.of(session));
        when(gateway.readMessages("uid-1")).thenReturn(List.of(inbound));
        when(store.sourceFingerprint(20L, inbound)).thenReturn("new-fingerprint");

        assertThatThrownBy(() -> service.send(1L, 10L, 1))
                .isInstanceOf(HrAssistantStore.StaleProposalException.class)
                .hasMessageContaining("重新生成");

        verify(gateway, never()).openConversation(session);
        verify(gateway, never()).fillAndSend("建议回复");
    }

    @Test
    void sendPhaseFailureBecomesUnknownAndIsNeverRetried() {
        var record = record("source-fingerprint");
        ChatSession session = session("原始消息");
        ChatMessage inbound = new ChatMessage("对方", "文本", "原始消息", "11:02");
        ProposalView unknown = proposal("SEND_UNKNOWN", 4);
        when(store.requireProposal(1L, 10L)).thenReturn(record);
        when(gateway.listChats(100)).thenReturn(List.of(session));
        when(gateway.readMessages("uid-1")).thenReturn(List.of(inbound));
        when(store.sourceFingerprint(20L, inbound)).thenReturn("source-fingerprint");
        doThrow(new IllegalStateException("OpenCLI 超时")).when(gateway).fillAndSend("建议回复");
        when(store.getProposalView(1L, 10L)).thenReturn(proposal("SENDING", 3), unknown);

        ProposalView result = service.send(1L, 10L, 1);

        assertThat(result.status()).isEqualTo("SEND_UNKNOWN");
        verify(gateway, times(1)).fillAndSend("建议回复");
        verify(store).markFinal(eq(10L), eq(ProposalStatus.SEND_UNKNOWN), contains("OpenCLI 超时"));
    }

    @Test
    void confirmsOnlyANewMatchingOutboundMessage() {
        var record = record("source-fingerprint");
        ChatSession session = session("原始消息");
        ChatMessage inbound = new ChatMessage("对方", "文本", "原始消息", "11:02");
        ChatMessage oldSameText = new ChatMessage("我", "文本", "建议回复", "10:00");
        ChatMessage newSameText = new ChatMessage("我", "文本", "建议回复", "11:03");
        ProposalView sent = proposal("SENT_CONFIRMED", 4);
        when(store.requireProposal(1L, 10L)).thenReturn(record);
        when(gateway.listChats(100)).thenReturn(List.of(session));
        when(gateway.readMessages("uid-1")).thenReturn(
                List.of(oldSameText, inbound), List.of(oldSameText, inbound, newSameText));
        when(store.sourceFingerprint(20L, inbound)).thenReturn("source-fingerprint");
        when(store.getProposalView(1L, 10L)).thenReturn(proposal("SENDING", 3), sent);

        ProposalView result = service.send(1L, 10L, 1);

        assertThat(result.status()).isEqualTo("SENT_CONFIRMED");
        verify(store).markFinal(eq(10L), eq(ProposalStatus.SENT_CONFIRMED), contains("回读一致"));
    }

    private HrAssistantStore.ProposalRecord record(String sourceFingerprint) {
        return new HrAssistantStore.ProposalRecord(10L, 1L, 20L, "1234", sourceFingerprint,
                ProposalStatus.REVIEW_REQUIRED, "REPLY", "建议回复", 1,
                LocalDateTime.now().plusMinutes(10), "uid-1", "胡女士", "公司", "岗位", sourceFingerprint);
    }

    private ChatSession session(String lastMessage) {
        return new ChatSession("uid-1", "security", "胡女士", "公司", "岗位", "HR", lastMessage, "11:02");
    }

    private ProposalView proposal(String status, int version) {
        return new ProposalView(10L, 1L, 20L, "1234", status, "REPLY", "胡女士", "公司", "岗位",
                "原始消息", "建议回复", "摘要", List.of(), List.of(), 0.9, version,
                LocalDateTime.now().plusMinutes(10), LocalDateTime.now(), false);
    }
}
