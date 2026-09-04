package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.SendCommandView;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HrReplyActionServiceTest {
    private final HrAssistantStore store = mock(HrAssistantStore.class);
    private final HrAssistantEventService events = mock(HrAssistantEventService.class);
    private final HrReplyActionService service = new HrReplyActionService(store, events);

    @Test
    void explicitConfirmationOnlyQueuesACommandForTheBoundExtension() {
        when(store.queueSendCommand(1L, 10L, 2, "")).thenReturn("command-1");
        when(store.getProposalView(1L, 10L)).thenReturn(proposal("APPROVED"));

        ProposalView result = service.send(1L, 10L, 2);

        assertThat(result.status()).isEqualTo("APPROVED");
        verify(store).queueSendCommand(1L, 10L, 2, "");
    }

    @Test
    void claimsOneCommandAndRecordsResultUnknownWithoutRetrying() {
        SendCommandView command = new SendCommandView("command-1", "lease", 10L, "uid-1", "HR", "公司", "岗位",
                "fingerprint", new ChatMessage("对方", "文本", "你好", "11:02"), "您好", LocalDateTime.now().plusMinutes(1));
        when(store.claimSendCommand(1L, "watch-1")).thenReturn(command);
        when(store.completeSendCommand(1L, "watch-1", "command-1", "lease", "RESULT_UNKNOWN", "未确认", null))
                .thenReturn(proposal("SEND_UNKNOWN"));

        assertThat(service.claim(1L, "watch-1").commandId()).isEqualTo("command-1");
        assertThat(service.complete(1L, "watch-1", "command-1", "lease", "RESULT_UNKNOWN", "未确认", null).status())
                .isEqualTo("SEND_UNKNOWN");
        verify(store).completeSendCommand(1L, "watch-1", "command-1", "lease", "RESULT_UNKNOWN", "未确认", null);
    }

    private ProposalView proposal(String status) {
        return new ProposalView(10L, 1L, 20L, "1234", status, "REPLY", "HR", "公司", "岗位",
                "你好", "您好", "摘要", List.of(), List.of(), 0.9, 2,
                LocalDateTime.now().plusMinutes(10), LocalDateTime.now(), false);
    }
}
