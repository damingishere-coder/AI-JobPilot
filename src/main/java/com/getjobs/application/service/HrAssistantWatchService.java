package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.AiDraft;
import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import com.getjobs.application.hr.HrAssistantTypes.Classification;
import com.getjobs.application.hr.HrAssistantTypes.GatewayStatus;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.UnreadConversation;
import com.getjobs.application.hr.HrAssistantTypes.UnreadSnapshot;
import com.getjobs.application.hr.HrAssistantTypes.WatchStatus;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@Slf4j
@Service
public class HrAssistantWatchService {
    private final OpenCliBossGateway gateway;
    private final ProfileService profileService;
    private final HrAssistantStore store;
    private final HrReplyDraftService draftService;
    private final HrAssistantEventService events;
    private final NapCatGateway napCatGateway;
    private final int maxConversations;
    private final long scanIntervalMs;
    private final AtomicBoolean watching = new AtomicBoolean(false);
    private final AtomicBoolean scanRunning = new AtomicBoolean(false);
    private final ExecutorService scanExecutor = Executors.newSingleThreadExecutor(Thread.ofVirtual().name("boss-hr-scan-", 0).factory());
    private volatile LocalDateTime lastScanAt;
    private volatile String lastError = "";

    public HrAssistantWatchService(OpenCliBossGateway gateway,
                                   ProfileService profileService,
                                   HrAssistantStore store,
                                   HrReplyDraftService draftService,
                                   HrAssistantEventService events,
                                   NapCatGateway napCatGateway,
                                   @Value("${app.hr-assistant.max-conversations-per-scan:100}") int maxConversations,
                                   @Value("${app.hr-assistant.scan-interval-ms:60000}") long scanIntervalMs) {
        this.gateway = gateway;
        this.profileService = profileService;
        this.store = store;
        this.draftService = draftService;
        this.events = events;
        this.napCatGateway = napCatGateway;
        this.maxConversations = Math.max(1, Math.min(maxConversations, 100));
        this.scanIntervalMs = Math.max(60_000, scanIntervalMs);
    }

    public WatchStatus start() {
        if (watching.get()) return status();
        GatewayStatus status = gateway.status();
        if (!status.ready()) throw new IllegalStateException("OpenCLI 尚未就绪：" + status.detail());
        profileService.getCurrentProfileId();
        gateway.bindCurrentChatTab();
        watching.set(true);
        lastError = "";
        events.emit("watch-status", status());
        scanExecutor.submit(this::scanOnce);
        return status();
    }

    public WatchStatus stop() {
        watching.set(false);
        events.emit("watch-status", status());
        return status();
    }

    public WatchStatus status() {
        LocalDateTime next = watching.get() && lastScanAt != null
                ? lastScanAt.plusNanos(scanIntervalMs * 1_000_000)
                : null;
        return new WatchStatus(watching.get(), scanRunning.get(), lastScanAt, next, lastError,
                gateway.status(), napCatGateway.isConnected(), true);
    }

    @Scheduled(fixedRate = 60_000)
    public void scheduledScan() {
        if (watching.get() && !scanRunning.get()) scanExecutor.submit(this::scanOnce);
    }

    @Scheduled(cron = "0 15 3 * * *")
    public void purgeExpiredSensitiveData() {
        int deleted = store.purgeExpired();
        if (deleted > 0) log.info("已清理 {} 条过期 HR 消息正文", deleted);
    }

    void scanOnce() {
        if (!watching.get() || !scanRunning.compareAndSet(false, true)) return;
        Long profileId = null;
        try {
            if (lastScanAt != null && LocalDateTime.now().isBefore(lastScanAt.plusNanos(scanIntervalMs * 1_000_000))) {
                return;
            }
            profileId = profileService.getCurrentProfileId();
            HrAssistantStore.SettingsSecret settings = store.loadSettingsSecret(profileId);
            List<ChatSession> sessions = gateway.listChats(maxConversations);
            int processed = 0;
            int consecutiveScrollsWithoutVisibleUnread = 0;
            while (processed < maxConversations && watching.get()) {
                gateway.openUnreadTab();
                UnreadSnapshot snapshot = gateway.readUnreadSnapshot();
                if (snapshot.totalUnread() == 0) break;
                if (snapshot.conversations().isEmpty()) {
                    if (consecutiveScrollsWithoutVisibleUnread < 20 && gateway.scrollUnreadList()) {
                        consecutiveScrollsWithoutVisibleUnread++;
                        continue;
                    }
                    throw new IllegalStateException("BOSS 显示有未读消息，但 OpenCLI 没有找到头像红点；可能是页面结构已变化");
                }
                consecutiveScrollsWithoutVisibleUnread = 0;
                UnreadConversation unread = snapshot.conversations().get(0);
                try {
                    processUnread(profileId, settings, sessions, unread);
                } catch (RuntimeException itemFailure) {
                    lastError = concise(itemFailure);
                    events.emit("conversation-blocked", java.util.Map.of("message", lastError, "hrName", safe(unread.hrName())));
                    log.warn("HR 未读会话处理被阻止: {}", lastError);
                    throw itemFailure;
                }
                processed++;
            }
            lastScanAt = LocalDateTime.now();
            lastError = "";
            events.emit("scan-complete", java.util.Map.of("processed", processed, "lastScanAt", lastScanAt.toString()));
        } catch (RuntimeException gatewayFailure) {
            lastError = concise(gatewayFailure);
            watching.set(false);
            events.emit("watch-paused", java.util.Map.of("message", lastError));
            if (profileId != null && !napCatGateway.notifySystemFault(profileId, lastError)) {
                events.emit("qq-notification-failed", java.util.Map.of("message", "值守故障已记录，但 NapCat 未连接或私聊通知发送失败"));
            }
            log.warn("BOSS HR 值守已暂停: {}", lastError);
        } finally {
            scanRunning.set(false);
        }
    }

    private void processUnread(Long profileId,
                               HrAssistantStore.SettingsSecret settings,
                               List<ChatSession> sessions,
                               UnreadConversation unread) {
        ChatSession session = gateway.matchUnique(unread, sessions);
        gateway.openConversation(unread);
        List<ChatMessage> messages = gateway.readMessages(session.uid());
        if (messages.isEmpty()) throw new IllegalStateException("OpenCLI 未返回该未读会话的聊天记录，已暂停避免漏读");
        long conversationId = store.upsertConversation(profileId, session);
        for (ChatMessage message : messages) store.saveMessage(conversationId, message, settings.retentionDays());
        ChatMessage source = latestInboundForCurrentLastMessage(messages, session.lastMessage());
        if (source == null) throw new IllegalStateException("未读会话的最新入站消息与结构化聊天记录不一致，已暂停避免错回");
        String sourceFingerprint = store.sourceFingerprint(conversationId, source);
        store.updateLastInbound(conversationId, sourceFingerprint);
        if (store.hasProposalForSource(conversationId, sourceFingerprint)) return;

        AiDraft draft;
        if (!"文本".equals(source.type())) {
            draft = new AiDraft(Classification.NEEDS_USER, "", "HR 发送了非文本消息，需要人工查看。",
                    List.of("NON_TEXT_MESSAGE"), List.of("请人工查看 " + source.type()), 1);
        } else {
            try {
                draft = draftService.generate(profileId, conversationId, settings.communicationProfile(), store.recentMessages(conversationId, 12));
            } catch (RuntimeException aiFailure) {
                draft = new AiDraft(Classification.NEEDS_USER, "", "AI 草稿生成失败，需要人工填写回复。",
                        List.of("AI_FAILURE"), List.of("请人工填写回复"), 0);
                events.emit("ai-draft-failed", java.util.Map.of("message", concise(aiFailure), "hrName", safe(unread.hrName())));
            }
        }
        long proposalId = store.createProposal(profileId, conversationId, sourceFingerprint, draft);
        ProposalView proposal = store.getProposalView(profileId, proposalId);
        events.emit("proposal-created", proposal);
        if (proposal.highValue() && !napCatGateway.notifyProposal(proposal)) {
            events.emit("qq-notification-failed", java.util.Map.of("proposalId", proposal.id(), "message", "NapCat 未连接或私聊通知发送失败"));
        }
    }

    private ChatMessage latestInboundForCurrentLastMessage(List<ChatMessage> messages, String currentLastMessage) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            ChatMessage message = messages.get(i);
            if (message.inbound() && !safe(currentLastMessage).isBlank()
                    && safe(message.text()).contains(safe(currentLastMessage))) return message;
        }
        if (!safe(currentLastMessage).isBlank()) return null;
        ChatMessage last = messages.get(messages.size() - 1);
        return last.inbound() ? last : null;
    }

    private String concise(Throwable error) {
        String value = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        return value.length() <= 400 ? value : value.substring(0, 400);
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    @PreDestroy
    public void shutdown() {
        watching.set(false);
        scanExecutor.shutdownNow();
    }
}
