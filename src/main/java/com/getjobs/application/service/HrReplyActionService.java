package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import com.getjobs.application.hr.HrAssistantTypes.ProposalStatus;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class HrReplyActionService {
    private final HrAssistantStore store;
    private final OpenCliBossGateway gateway;
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
        HrAssistantStore.ProposalRecord record = store.requireProposal(profileId, proposalId);
        validateBeforeSend(record, expectedVersion);
        ChatSession session = findSession(record.uid());
        List<ChatMessage> before = gateway.readMessages(session.uid());
        Set<String> beforeOutbound = new HashSet<>();
        before.stream().filter(message -> "我".equals(message.from())).map(this::messageIdentity).forEach(beforeOutbound::add);
        ChatMessage latestInbound = latestInboundForCurrentLastMessage(before, session.lastMessage());
        if (latestInbound == null || !store.sourceFingerprint(record.conversationId(), latestInbound).equals(record.sourceFingerprint())) {
            throw new HrAssistantStore.StaleProposalException("HR 已发送新消息或来源消息发生变化，请重新生成草稿");
        }

        try {
            gateway.openConversation(session);
        } catch (RuntimeException preSendFailure) {
            store.transition(proposalId, ProposalStatus.REVIEW_REQUIRED, ProposalStatus.BLOCKED);
            throw preSendFailure;
        }

        store.transition(proposalId, ProposalStatus.REVIEW_REQUIRED, ProposalStatus.APPROVED);
        store.transition(proposalId, ProposalStatus.APPROVED, ProposalStatus.SENDING);
        events.emit("proposal-sending", store.getProposalView(profileId, proposalId));
        try {
            gateway.fillAndSend(record.draft());
            waitForUiCommit();
            List<ChatMessage> after = gateway.readMessages(session.uid());
            boolean confirmed = after.stream().anyMatch(message -> "我".equals(message.from())
                    && record.draft().equals(message.text().trim())
                    && !beforeOutbound.contains(messageIdentity(message)));
            if (!confirmed) {
                store.markFinal(proposalId, ProposalStatus.SEND_UNKNOWN, "OpenCLI 已提交输入，但聊天回读未发现相同出站正文");
            } else {
                store.markFinal(proposalId, ProposalStatus.SENT_CONFIRMED, "OpenCLI DOM 发送成功且聊天历史回读一致");
            }
        } catch (RuntimeException failure) {
            store.markFinal(proposalId, ProposalStatus.SEND_UNKNOWN, "发送阶段异常：" + safeMessage(failure));
        }
        ProposalView result = store.getProposalView(profileId, proposalId);
        events.emit("proposal-updated", result);
        return result;
    }

    public ProposalView sendByCode(Long profileId, String code) {
        HrAssistantStore.ProposalRecord record = store.requireProposalByCode(profileId, normalizeCode(code));
        return send(profileId, record.id(), record.version());
    }

    public ProposalView detailByCode(Long profileId, String code) {
        HrAssistantStore.ProposalRecord record = store.requireProposalByCode(profileId, normalizeCode(code));
        return store.getProposalView(profileId, record.id());
    }

    private void validateBeforeSend(HrAssistantStore.ProposalRecord record, int expectedVersion) {
        if (record.status() != ProposalStatus.REVIEW_REQUIRED) {
            throw new HrAssistantStore.StaleProposalException("回复任务当前不可发送");
        }
        if (record.version() != expectedVersion) {
            throw new HrAssistantStore.StaleProposalException("草稿版本已变化，请刷新后重新确认");
        }
        if (record.expiresAt().isBefore(java.time.LocalDateTime.now())) {
            throw new HrAssistantStore.StaleProposalException("确认码已过期");
        }
        if (!record.sourceFingerprint().equals(record.lastInboundFingerprint())) {
            throw new HrAssistantStore.StaleProposalException("HR 已发送新消息，旧确认已作废");
        }
        if (record.draft() == null || record.draft().isBlank()) {
            throw new IllegalArgumentException("回复正文为空，不能发送");
        }
    }

    private ChatSession findSession(String uid) {
        List<ChatSession> matches = gateway.listChats(100).stream().filter(item -> item.uid().equals(uid)).toList();
        if (matches.size() != 1) throw new IllegalStateException("发送前无法唯一定位 BOSS 会话");
        return matches.get(0);
    }

    private ChatMessage latestInboundForCurrentLastMessage(List<ChatMessage> messages, String currentLastMessage) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            ChatMessage message = messages.get(i);
            if (message.inbound() && (!safe(currentLastMessage).isBlank()
                    && safe(message.text()).contains(safe(currentLastMessage)))) return message;
        }
        if (!safe(currentLastMessage).isBlank() || messages.isEmpty()) return null;
        ChatMessage last = messages.get(messages.size() - 1);
        return last.inbound() ? last : null;
    }

    private void waitForUiCommit() {
        try {
            Thread.sleep(1_200);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("等待发送回读时任务被中断，结果未知", e);
        }
    }

    private String normalizeCode(String code) {
        String value = code == null ? "" : code.trim();
        if (!value.matches("\\d{4}")) throw new IllegalArgumentException("确认码必须是 4 位数字");
        return value;
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private String safeMessage(Throwable error) {
        String value = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        return value.length() <= 300 ? value : value.substring(0, 300);
    }

    private String messageIdentity(ChatMessage message) {
        return safe(message.from()) + "|" + safe(message.type()) + "|" + safe(message.time()) + "|" + safe(message.text());
    }
}
