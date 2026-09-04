package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.AiDraft;
import com.getjobs.application.hr.HrAssistantTypes.ChatCapture;
import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import com.getjobs.application.hr.HrAssistantTypes.ChromeBridgeStatus;
import com.getjobs.application.hr.HrAssistantTypes.Classification;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.ScanReceipt;
import com.getjobs.application.hr.HrAssistantTypes.WatchStatus;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

@Slf4j
@Service
public class HrAssistantWatchService {
    private static final long SCAN_INTERVAL_MS = 60_000L;
    private final ProfileService profileService;
    private final HrAssistantStore store;
    private final HrReplyDraftService draftService;
    private final HrAssistantEventService events;
    private final NapCatGateway napCatGateway;
    private final int maxConversations;
    private final AtomicBoolean watching = new AtomicBoolean(false);
    private final AtomicBoolean processingScan = new AtomicBoolean(false);
    private volatile boolean browserScanRunning;
    private volatile WatchSession session;
    private volatile LocalDateTime lastScanAt;
    private volatile LocalDateTime lastHeartbeatAt;
    private volatile String lastError = "";
    private volatile int outboxCount;

    public HrAssistantWatchService(ProfileService profileService,
                                   HrAssistantStore store,
                                   HrReplyDraftService draftService,
                                   HrAssistantEventService events,
                                   NapCatGateway napCatGateway,
                                   @Value("${app.hr-assistant.max-conversations-per-scan:100}") int maxConversations) {
        this.profileService = profileService;
        this.store = store;
        this.draftService = draftService;
        this.events = events;
        this.napCatGateway = napCatGateway;
        this.maxConversations = Math.max(1, Math.min(maxConversations, 100));
    }

    public synchronized WatchStatus start(int tabId, String url, String contentVersion, String browserSessionId) {
        validateChatTab(tabId, url, contentVersion, browserSessionId);
        if (watching.get()) {
            if (session != null && session.tabId() == tabId && session.browserSessionId().equals(browserSessionId)) return status();
            throw new IllegalStateException("已有其他 BOSS 标签页正在值守，请先在原标签页停止");
        }
        Long profileId = profileService.getCurrentProfileId();
        session = new WatchSession(UUID.randomUUID().toString(), browserSessionId.trim(), profileId,
                tabId, url.trim(), contentVersion.trim());
        watching.set(true);
        processingScan.set(false);
        browserScanRunning = false;
        lastScanAt = null;
        lastHeartbeatAt = LocalDateTime.now();
        lastError = "";
        outboxCount = 0;
        WatchStatus status = status();
        events.emit("watch-status", status);
        return status;
    }

    public synchronized WatchStatus stop(String watchSessionId, String reason) {
        if (session != null && watchSessionId != null && !watchSessionId.isBlank()
                && !session.watchSessionId().equals(watchSessionId.trim())) {
            throw new HrAssistantStore.StaleProposalException("值守会话已变化，拒绝停止其他标签页的值守");
        }
        watching.set(false);
        processingScan.set(false);
        browserScanRunning = false;
        lastError = safe(reason);
        if (session != null && !lastError.isBlank() && !lastError.startsWith("USER_STOPPED")) {
            napCatGateway.notifySystemFault(session.profileId(), lastError);
        }
        WatchStatus status = status();
        events.emit("watch-status", status);
        return status;
    }

    public synchronized WatchStatus heartbeat(String watchSessionId,
                                               int tabId,
                                               String url,
                                               String contentVersion,
                                               boolean browserScanRunning,
                                               int browserOutboxCount,
                                               String fault) {
        requireSession(watchSessionId, tabId);
        validateChatTab(tabId, url, contentVersion, session.browserSessionId());
        session = new WatchSession(session.watchSessionId(), session.browserSessionId(), session.profileId(),
                tabId, url.trim(), contentVersion.trim());
        lastHeartbeatAt = LocalDateTime.now();
        this.browserScanRunning = browserScanRunning;
        outboxCount = Math.max(0, browserOutboxCount);
        if (fault != null && !fault.isBlank()) {
            lastError = concise(fault);
            watching.set(false);
            processingScan.set(false);
            this.browserScanRunning = false;
            napCatGateway.notifySystemFault(session.profileId(), lastError);
            events.emit("watch-paused", java.util.Map.of("message", lastError));
        }
        return status();
    }

    public ScanReceipt ingestScan(String watchSessionId,
                                  int tabId,
                                  String scanId,
                                  int totalUnread,
                                  List<ChatCapture> captures) {
        WatchSession active = requireSession(watchSessionId, tabId);
        String normalizedScanId = requireNonBlank(scanId, "scanId");
        List<ChatCapture> safeCaptures = captures == null ? List.of() : List.copyOf(captures);
        if (safeCaptures.size() > maxConversations) throw new IllegalArgumentException("单轮 HR 会话数量超过 " + maxConversations);
        if (totalUnread > 0 && safeCaptures.isEmpty()) {
            throw new IllegalStateException("BOSS 显示有未读消息，但扩展未能安全识别任何带红点会话，值守已暂停");
        }
        Set<String> uniqueUids = new HashSet<>();
        for (ChatCapture capture : safeCaptures) {
            if (capture != null && capture.session() != null && !uniqueUids.add(safe(capture.session().uid()))) {
                throw new HrAssistantStore.StaleProposalException("同一轮扫描出现重复会话 UID，已暂停避免错误映射");
            }
        }
        if (!processingScan.compareAndSet(false, true)) throw new IllegalStateException("上一轮 HR 消息仍在处理，本轮已跳过");
        List<String> acknowledged = new ArrayList<>();
        int processed = 0;
        int duplicates = 0;
        try {
            HrAssistantStore.SettingsSecret settings = store.loadSettingsSecret(active.profileId());
            for (ChatCapture capture : safeCaptures) {
                validateCapture(capture);
                boolean shouldProcess = store.beginCapture(active.profileId(), active.watchSessionId(), normalizedScanId, capture.captureId());
                if (!shouldProcess) {
                    duplicates++;
                    acknowledged.add(capture.captureId());
                    continue;
                }
                try {
                    processCapture(active.profileId(), settings, capture);
                    store.completeCapture(active.watchSessionId(), capture.captureId());
                    acknowledged.add(capture.captureId());
                    processed++;
                } catch (RuntimeException failure) {
                    store.failCapture(active.watchSessionId(), capture.captureId(), errorCode(failure));
                    throw failure;
                }
            }
            lastScanAt = LocalDateTime.now();
            lastHeartbeatAt = lastScanAt;
            lastError = "";
            outboxCount = Math.max(0, outboxCount - acknowledged.size());
            ScanReceipt receipt = new ScanReceipt(normalizedScanId, safeCaptures.size(), processed, duplicates, acknowledged);
            events.emit("scan-complete", java.util.Map.of(
                    "processed", processed, "duplicates", duplicates, "totalUnread", Math.max(0, totalUnread),
                    "lastScanAt", lastScanAt.toString()));
            return receipt;
        } catch (RuntimeException failure) {
            lastError = concise(failure);
            events.emit("scan-failed", java.util.Map.of("message", lastError, "scanId", normalizedScanId));
            throw failure;
        } finally {
            processingScan.set(false);
        }
    }

    public WatchStatus status() {
        WatchSession active = session;
        LocalDateTime next = watching.get() && lastScanAt != null ? lastScanAt.plusNanos(SCAN_INTERVAL_MS * 1_000_000) : null;
        ChromeBridgeStatus bridge = new ChromeBridgeStatus(active != null, watching.get() && active != null,
                active == null ? null : active.tabId(), active == null ? "" : active.url(),
                active == null ? "" : active.contentVersion(), lastHeartbeatAt, outboxCount,
                active == null ? "等待 BOSS 聊天页绑定" : "投递牛马 Chrome 扩展直连");
        return new WatchStatus(watching.get(), browserScanRunning || processingScan.get(), active == null ? "" : active.watchSessionId(), SCAN_INTERVAL_MS,
                lastScanAt, next, lastError, bridge, napCatGateway.isConnected(), true);
    }

    public String requireActiveWatchSession(Long profileId) {
        WatchSession active = session;
        if (!watching.get() || active == null) throw new IllegalStateException("请先在 BOSS 聊天页开始值守");
        if (!active.profileId().equals(profileId)) throw new HrAssistantStore.StaleProposalException("当前人物档案已变化，请重新开始值守");
        return active.watchSessionId();
    }

    public void assertActiveSession(Long profileId, String watchSessionId, int tabId) {
        WatchSession active = requireSession(watchSessionId, tabId);
        if (!active.profileId().equals(profileId)) {
            throw new HrAssistantStore.StaleProposalException("当前人物档案已变化，请重新开始值守");
        }
    }

    @Scheduled(cron = "0 15 3 * * *")
    public void purgeExpiredSensitiveData() {
        int deleted = store.purgeExpired();
        if (deleted > 0) log.info("已清理 {} 条过期 HR 消息正文", deleted);
    }

    private void processCapture(Long profileId, HrAssistantStore.SettingsSecret settings, ChatCapture capture) {
        ChatSession chat = capture.session();
        long conversationId = store.upsertConversation(profileId, chat);
        for (ChatMessage message : capture.messages()) store.saveMessage(conversationId, message, settings.retentionDays());
        ChatMessage source = latestInboundForCurrentLastMessage(capture.messages(), chat.lastMessage());
        if (source == null) throw new IllegalStateException("最新入站消息与会话列表不一致，已保留 Outbox 并停止处理");
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
                events.emit("ai-draft-failed", java.util.Map.of("message", concise(aiFailure), "hrName", safe(chat.hrName())));
            }
        }
        long proposalId = store.createProposal(profileId, conversationId, sourceFingerprint, draft);
        ProposalView proposal = store.getProposalView(profileId, proposalId);
        events.emit("proposal-created", proposal);
        if (proposal.highValue() && !napCatGateway.notifyProposal(proposal)) {
            events.emit("qq-notification-failed", java.util.Map.of("proposalId", proposal.id(), "message", "NapCat 未连接或 QQ 通知发送失败"));
        }
    }

    private ChatMessage latestInboundForCurrentLastMessage(List<ChatMessage> messages, String currentLastMessage) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            ChatMessage message = messages.get(i);
            if (message.inbound() && (safe(currentLastMessage).isBlank() || compatible(message.text(), currentLastMessage))) return message;
        }
        return null;
    }

    private WatchSession requireSession(String watchSessionId, int tabId) {
        WatchSession active = session;
        if (!watching.get() || active == null) throw new IllegalStateException("BOSS HR 值守未启动或已暂停");
        if (!active.watchSessionId().equals(safe(watchSessionId)) || active.tabId() != tabId) {
            throw new HrAssistantStore.StaleProposalException("值守会话或标签页已变化，拒绝处理旧请求");
        }
        return active;
    }

    private void validateCapture(ChatCapture capture) {
        if (capture == null) throw new IllegalArgumentException("HR 消息快照不能为空");
        requireNonBlank(capture.captureId(), "captureId");
        if (capture.session() == null) throw new IllegalArgumentException("HR 消息快照缺少会话身份");
        requireNonBlank(capture.session().uid(), "会话 UID");
        if (capture.messages().isEmpty()) throw new IllegalArgumentException("HR 消息快照缺少聊天记录");
    }

    private void validateChatTab(int tabId, String url, String contentVersion, String browserSessionId) {
        if (tabId <= 0) throw new IllegalArgumentException("BOSS 标签页 ID 无效");
        requireNonBlank(contentVersion, "Chrome 扩展内容脚本版本");
        requireNonBlank(browserSessionId, "浏览器值守会话 ID");
        try {
            URI parsed = URI.create(requireNonBlank(url, "BOSS 标签页地址"));
            String host = parsed.getHost() == null ? "" : parsed.getHost().toLowerCase();
            if (!"https".equalsIgnoreCase(parsed.getScheme())
                    || !(host.equals("zhipin.com") || host.endsWith(".zhipin.com"))
                    || !parsed.getPath().startsWith("/web/geek/chat")) {
                throw new IllegalArgumentException("请在当前 BOSS 求职者聊天页开始值守");
            }
        } catch (IllegalArgumentException invalidUrl) {
            if ("请在当前 BOSS 求职者聊天页开始值守".equals(invalidUrl.getMessage())) throw invalidUrl;
            throw new IllegalArgumentException("BOSS 标签页地址无效");
        }
    }

    private boolean compatible(String left, String right) {
        String a = safe(left).replaceAll("\\s+", "").toLowerCase();
        String b = safe(right).replaceAll("\\s+", "").toLowerCase();
        return !a.isBlank() && !b.isBlank() && (a.equals(b) || a.contains(b) || b.contains(a));
    }

    private String requireNonBlank(String value, String label) {
        String normalized = safe(value);
        if (normalized.isBlank()) throw new IllegalArgumentException(label + "不能为空");
        return normalized;
    }

    private String errorCode(Throwable error) {
        if (error instanceof HrAssistantStore.StaleProposalException) return "STALE_STATE";
        if (error instanceof IllegalArgumentException) return "INVALID_CAPTURE";
        return "CAPTURE_PROCESSING_FAILED";
    }

    private String concise(Throwable error) {
        String value = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        return value.length() <= 400 ? value : value.substring(0, 400);
    }

    private String concise(String value) {
        String safe = value == null ? "" : value;
        return safe.length() <= 400 ? safe : safe.substring(0, 400);
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private record WatchSession(String watchSessionId, String browserSessionId, Long profileId,
                                int tabId, String url, String contentVersion) {
    }
}
