package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.SendCommandView;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class HrReplyActionService {
    private final HrAssistantStore store;
    private final HrAssistantEventService events;

    public ProposalView revise(Long profileId, long proposalId, int expectedVersion, String newDraft) {
        ProposalView updated = store.revise(profileId, proposalId, expectedVersion, newDraft);
        events.emit("proposal-updated", updated);
        return updated;
    }

    public ProposalView reviseByCode(Long profileId, String code, String newDraft) {
        HrAssistantStore.ProposalRecord record = store.requireProposalByCode(profileId, normalizeCode(code));
        return revise(profileId, record.id(), record.version(), newDraft);
    }

    public ProposalView skip(Long profileId, long proposalId) {
        store.skip(profileId, proposalId);
        ProposalView updated = store.getProposalView(profileId, proposalId);
        events.emit("proposal-updated", updated);
        return updated;
    }

    public ProposalView skipByCode(Long profileId, String code) {
        HrAssistantStore.ProposalRecord record = store.requireProposalByCode(profileId, normalizeCode(code));
        return skip(profileId, record.id());
    }

    public ProposalView send(Long profileId, long proposalId, int expectedVersion) {
        String commandId = store.queueSendCommand(profileId, proposalId, expectedVersion, "");
        ProposalView queued = store.getProposalView(profileId, proposalId);
        events.emit("proposal-send-pending", java.util.Map.of("commandId", commandId, "proposal", queued));
        return queued;
    }

    public ProposalView sendByCode(Long profileId, String code) {
        HrAssistantStore.ProposalRecord record = store.requireProposalByCode(profileId, normalizeCode(code));
        return send(profileId, record.id(), record.version());
    }

    public SendCommandView claim(Long profileId, String watchSessionId) {
        SendCommandView command = store.claimSendCommand(profileId, watchSessionId);
        if (command != null) events.emit("proposal-sending", store.getProposalView(profileId, command.proposalId()));
        return command;
    }

    public ProposalView complete(Long profileId,
                                 String watchSessionId,
                                 String commandId,
                                 String leaseToken,
                                 String outcome,
                                 String evidence,
                                 ChatMessage observedLatestInbound) {
        ProposalView result = store.completeSendCommand(profileId, watchSessionId, commandId, leaseToken,
                outcome, evidence, observedLatestInbound);
        events.emit("proposal-updated", result);
        return result;
    }

    public ProposalView detailByCode(Long profileId, String code) {
        HrAssistantStore.ProposalRecord record = store.requireProposalByCode(profileId, normalizeCode(code));
        return store.getProposalView(profileId, record.id());
    }

    private String normalizeCode(String code) {
        String value = code == null ? "" : code.trim();
        if (!value.matches("\\d{4}")) throw new IllegalArgumentException("确认码必须是 4 位数字");
        return value;
    }
}
